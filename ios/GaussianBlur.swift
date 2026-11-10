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
        // Normalise to premultiplied 8888 — vImageBoxConvolve_ARGB8888 needs
        // four 8-bit channels, and premultiplied alpha is what keeps
        // transparent edges from bleeding dark halos into the blur.
        //
        // Three things about the result decide what Core Animation does with
        // it when it is first committed to a layer, on the main thread:
        //  - The bytes are laid out BGRA (alpha first, little-endian), not the
        //    ARGB the function's name suggests. The box filter treats all
        //    four channels alike, so the order changes no pixel.
        //  - The colour space is sRGB. This used to say device RGB, which the
        //    system treats as sRGB — the pixels are the same, wide-gamut
        //    sources included — but which Core Animation redraws.
        //  - The result lives in a bitmap context's backing store, which
        //    Core Animation shares. A buffer handed over through a data
        //    provider is copied instead — once more per displayed image.
        // Measured, a 1206x1206 blur result costs 0.04 ms to commit this way,
        // against 0.43 ms for a copied BGRA buffer and 1.08 ms for the
        // device-RGB ARGB one this started as.
        let bitmapInfo = CGBitmapInfo(rawValue:
            CGImageAlphaInfo.premultipliedFirst.rawValue | CGBitmapInfo.byteOrder32Little.rawValue
        )
        let colorSpace = CGColorSpace(name: CGColorSpace.sRGB) ?? CGColorSpaceCreateDeviceRGB()
        guard let context = CGContext(
            data: nil,
            width: cgImage.width,
            height: cgImage.height,
            bitsPerComponent: 8,
            bytesPerRow: 0,
            space: colorSpace,
            bitmapInfo: bitmapInfo.rawValue
        ), let backing = context.data else { return nil }
        guard var format = vImage_CGImageFormat(
            bitsPerComponent: 8,
            bitsPerPixel: 32,
            colorSpace: colorSpace,
            bitmapInfo: bitmapInfo,
            renderingIntent: .defaultIntent
        ) else { return nil }

        var source = vImage_Buffer()
        guard vImageBuffer_InitWithCGImage(
            &source, &format, nil, cgImage, vImage_Flags(kvImageNoFlags)
        ) == kvImageNoError else { return nil }
        defer { free(source.data) }

        // The context's backing store, as the buffer the passes end in.
        var result = vImage_Buffer(
            data: backing,
            height: vImagePixelCount(context.height),
            width: vImagePixelCount(context.width),
            rowBytes: context.bytesPerRow
        )
        guard runPasses(boxes, from: &source, into: &result) else { return nil }

        // Copy-on-write: the image takes over the backing store once the
        // context goes away without drawing again, so nothing is copied.
        return context.makeImage()
    }

    /// Runs one box-blur pass per entry of `boxes`, leaving the blur in
    /// `result`. `source` is overwritten: it doubles as the scratch buffer.
    private static func runPasses(
        _ boxes: [UInt32],
        from source: inout vImage_Buffer,
        into result: inout vImage_Buffer
    ) -> Bool {
        // kvImageEdgeExtend clamps at the borders instead of sampling
        // transparent black, so the image keeps its edges instead of fading
        // out into the frame (CIGaussianBlur's default, and the reason blurred
        // images used to come back with washed-out borders).
        let flags = vImage_Flags(kvImageEdgeExtend)
        // The passes use two different kernel widths; size the temp buffer
        // for the widest one so every pass fits in it.
        let widest = boxes.max() ?? 1
        let tempSize = vImageBoxConvolve_ARGB8888(
            &source, &result, nil, 0, 0, widest, widest, nil,
            vImage_Flags(kvImageEdgeExtend | kvImageGetTempBufferSize)
        )
        guard tempSize > 0, let temp = malloc(tempSize) else { return false }
        defer { free(temp) }

        // Ping-pong between the two buffers, starting towards `result`: after
        // an odd number of passes — there are always three — the blur sits in
        // it. `input` is whichever buffer was written last.
        var input = source
        var output = result
        for box in boxes {
            guard vImageBoxConvolve_ARGB8888(
                &input, &output, temp, 0, 0, box, box, nil, flags
            ) == kvImageNoError else { return false }
            swap(&input, &output)
        }
        guard input.data != result.data else { return true }
        // An even number of passes (or none) left it in `source`.
        return vImageCopyBuffer(&input, &result, 4, vImage_Flags(kvImageNoFlags)) == kvImageNoError
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
