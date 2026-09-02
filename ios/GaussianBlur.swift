//
//  GaussianBlur.swift
//  NitroImagePipeline
//
//  Cross-platform Gaussian blur — the kernel itself.
//
//  This file deliberately depends on nothing but Accelerate and CoreGraphics
//  so `scripts/verify-blur.swift` can compile and measure it on the host
//  machine. The UIImage/Nuke plumbing lives in GaussianBlurProcessor.swift.
//
//  `sigma` is the standard deviation of the Gaussian, measured in *source
//  image pixels* — the same sigma applied to the same source file produces
//  the same result on iOS and Android. It is deliberately not a "radius":
//  CIGaussianBlur, RenderScript and React Native's `blurRadius` each define
//  radius differently, which is why blurs never matched across platforms.
//
//  For reference, React Native's `<Image blurRadius={n} />` halves its input
//  before convolving, so `blurRadius={n}` is roughly `sigma = n / 2`.
//

import Accelerate
import CoreGraphics
import Foundation

enum GaussianBlur {
    /// Runs the box-blur passes over `cgImage`. Returns `nil` if the pixel
    /// buffers could not be allocated.
    static func convolve(_ cgImage: CGImage, boxes: [UInt32]) -> CGImage? {
        // Normalise to premultiplied ARGB8888 — vImageBoxConvolve_ARGB8888
        // needs four 8-bit channels, and premultiplied alpha is what keeps
        // transparent edges from bleeding dark halos into the blur.
        let colorSpace = CGColorSpaceCreateDeviceRGB()
        let bitmapInfo = CGBitmapInfo(rawValue: CGImageAlphaInfo.premultipliedFirst.rawValue)
        guard var format = vImage_CGImageFormat(
            bitsPerComponent: 8,
            bitsPerPixel: 32,
            colorSpace: colorSpace,
            bitmapInfo: bitmapInfo,
            renderingIntent: .defaultIntent
        ) else { return nil }

        // Both buffers are freed on exit, except the one handed over to the
        // result CGImage below (`handedOver`), which is freed with the image.
        var handedOver: UnsafeMutableRawPointer?
        var source = vImage_Buffer()
        guard vImageBuffer_InitWithCGImage(
            &source, &format, nil, cgImage, vImage_Flags(kvImageNoFlags)
        ) == kvImageNoError else { return nil }
        defer { if source.data != handedOver { free(source.data) } }

        var scratch = vImage_Buffer()
        guard vImageBuffer_Init(
            &scratch, source.height, source.width, 32, vImage_Flags(kvImageNoFlags)
        ) == kvImageNoError else { return nil }
        defer { if scratch.data != handedOver { free(scratch.data) } }

        // kvImageEdgeExtend clamps at the borders instead of sampling
        // transparent black, so the image keeps its edges instead of fading
        // out into the frame (CIGaussianBlur's default, and the reason blurred
        // images used to come back with washed-out borders).
        let flags = vImage_Flags(kvImageEdgeExtend)
        // The passes use two different kernel widths; size the scratch buffer
        // for the widest one so every pass fits in it.
        let widest = boxes.max() ?? 1
        let tempSize = vImageBoxConvolve_ARGB8888(
            &source, &scratch, nil, 0, 0, widest, widest, nil,
            vImage_Flags(kvImageEdgeExtend | kvImageGetTempBufferSize)
        )
        guard tempSize > 0, let temp = malloc(tempSize) else { return nil }
        defer { free(temp) }

        // Ping-pong between the two buffers; after an odd number of passes the
        // result sits in `input`.
        var input = source
        var output = scratch
        for box in boxes {
            guard vImageBoxConvolve_ARGB8888(
                &input, &output, temp, 0, 0, box, box, nil, flags
            ) == kvImageNoError else { return nil }
            swap(&input, &output)
        }

        // Ownership of the result buffer moves to the CGImage (no copy);
        // `handedOver` keeps the exits above from freeing it a second time.
        return makeImage(from: input, colorSpace: colorSpace, bitmapInfo: bitmapInfo, handedOver: &handedOver)
    }

    /// Wraps `buffer` in a CGImage instead of copying it (one full-bitmap
    /// memcpy less per blur). Ownership is explicit: once the data provider
    /// exists, it frees the buffer — together with the image, or right away
    /// if creating the image fails and the provider is released — so
    /// `handedOver` is set to the buffer's data as soon as that is the case.
    /// (vImageCreateCGImageFromBuffer with kvImageNoAllocate would do the
    /// same, but leaves unspecified whether its free callback runs when the
    /// call fails.)
    private static func makeImage(
        from buffer: vImage_Buffer,
        colorSpace: CGColorSpace,
        bitmapInfo: CGBitmapInfo,
        handedOver: inout UnsafeMutableRawPointer?
    ) -> CGImage? {
        guard let provider = CGDataProvider(
            dataInfo: nil,
            data: buffer.data,
            size: buffer.rowBytes * Int(buffer.height),
            releaseData: { _, data, _ in free(UnsafeMutableRawPointer(mutating: data)) }
        ) else { return nil }
        handedOver = buffer.data

        return CGImage(
            width: Int(buffer.width),
            height: Int(buffer.height),
            bitsPerComponent: 8,
            bitsPerPixel: 32,
            bytesPerRow: buffer.rowBytes,
            space: colorSpace,
            bitmapInfo: bitmapInfo,
            provider: provider,
            decode: nil,
            shouldInterpolate: true,
            intent: .defaultIntent
        )
    }

    /// Widths for the three box-blur passes that approximate a Gaussian of
    /// `sigma` (the classic approximation: three boxes land within a few
    /// percent of a true Gaussian, and Accelerate runs them in O(1) per pixel
    /// regardless of how wide they are).
    ///
    /// Three boxes of widths w1…w3 produce a standard deviation of
    /// `sqrt((w1² + w2² + w3² - 3) / 12)`. Box widths have to be odd, so the
    /// passes are split between the two odd integers straddling the ideal
    /// width and the split landing closest to `sigma` wins — which keeps the
    /// error under half a pixel at any sigma instead of always undershooting.
    static func boxSizes(forSigma sigma: Double) -> [UInt32] {
        let passes = 3
        var lower = Int(((12 * sigma * sigma / Double(passes)) + 1).squareRoot())
        if lower % 2 == 0 { lower -= 1 }
        // Upper bound keeps `upper` inside UInt32 for absurd sigmas; a kernel
        // that wide is already far larger than any real image.
        lower = min(max(lower, 1), Int(UInt32.max) - 2)
        let upper = lower + 2

        // Written as a plain loop rather than map/min(by:): the inferred
        // version tripped "type of expression is ambiguous" on Swift 6.2.
        var best: [UInt32] = []
        var bestError: Double = .infinity
        for lowerCount in 0...passes {
            var candidate: [UInt32] = []
            for pass in 0..<passes {
                candidate.append(UInt32(pass < lowerCount ? lower : upper))
            }
            // `.magnitude` rather than `abs()`: Nitro's C++ interop puts
            // std::abs overloads in scope, and Swift 6.2 calls the resulting
            // `abs` ambiguous when this file is compiled as part of the pod.
            let error: Double = (standardDeviation(of: candidate) - sigma).magnitude
            if error < bestError {
                bestError = error
                best = candidate
            }
        }
        return best
    }

    /// The standard deviation three box blurs of the given widths add up to.
    private static func standardDeviation(of boxes: [UInt32]) -> Double {
        var sum: Double = 0
        for box in boxes {
            let width = Double(box)
            sum += width * width - 1
        }
        return (sum / 12).squareRoot()
    }
}
