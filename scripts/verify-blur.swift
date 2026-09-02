//
//  verify-blur.swift
//
//  Host-side checks for the two blur kernels — ios/GaussianBlur.swift and
//  android/src/main/cpp/GaussianBlur.cpp (compiled for the host and reached
//  through verify-blur-bridge.h). Run with:
//
//      bun run verify:blur
//
//  Three properties are asserted, for both kernels:
//
//  1. `blur`/`gaussianBlur` is a Gaussian sigma in source-image pixels. The
//     measured sigma of a blurred step edge has to match the requested one,
//     which is what keeps iOS and Android agreeing on the same number.
//  2. Blurring an opaque image leaves its edges opaque and unchanged. The old
//     CIGaussianBlur path sampled transparent black outside the image, so
//     blurred images faded out at their borders.
//  3. The two kernels agree pixel for pixel (to within rounding) on the same
//     image: same box widths, same measured sigma, same output bytes.
//

import CoreGraphics
import Foundation

private let bitmapInfo = CGImageAlphaInfo.premultipliedFirst.rawValue
private let colorSpace = CGColorSpaceCreateDeviceRGB()

private struct Pixel {
    let alpha: UInt8
    let red: UInt8
    let green: UInt8
    let blue: UInt8
}

private struct Bitmap {
    let width: Int
    let height: Int
    var bytes: [UInt8]

    func pixel(column: Int, row: Int) -> Pixel {
        let offset = (row * width + column) * 4
        return Pixel(
            alpha: bytes[offset], red: bytes[offset + 1],
            green: bytes[offset + 2], blue: bytes[offset + 3]
        )
    }
}

/// A square test image, filled by `fill`.
private func makeImage(size: Int, fill: (Int, Int) -> Pixel) -> CGImage {
    // Owned by the CGImage for the rest of the process; this is a short-lived
    // check, so the buffer is intentionally not freed.
    let data = UnsafeMutableRawPointer.allocate(byteCount: size * size * 4, alignment: 16)
    let bytes = data.bindMemory(to: UInt8.self, capacity: size * size * 4)
    for row in 0..<size {
        for column in 0..<size {
            let pixel = fill(column, row)
            let offset = (row * size + column) * 4
            bytes[offset] = pixel.alpha
            bytes[offset + 1] = pixel.red
            bytes[offset + 2] = pixel.green
            bytes[offset + 3] = pixel.blue
        }
    }
    let context = CGContext(
        data: data, width: size, height: size, bitsPerComponent: 8, bytesPerRow: size * 4,
        space: colorSpace, bitmapInfo: bitmapInfo
    )!
    return context.makeImage()!
}

private func readPixels(of image: CGImage) -> Bitmap {
    let width = image.width
    let height = image.height
    var bytes = [UInt8](repeating: 0, count: width * height * 4)
    bytes.withUnsafeMutableBytes { raw in
        let context = CGContext(
            data: raw.baseAddress, width: width, height: height, bitsPerComponent: 8,
            bytesPerRow: width * 4, space: colorSpace, bitmapInfo: bitmapInfo
        )!
        context.draw(image, in: CGRect(x: 0, y: 0, width: width, height: height))
    }
    return Bitmap(width: width, height: height, bytes: bytes)
}

/// The two kernels under test. Both take the same premultiplied 8-bit pixels;
/// the Android one runs in place on a copy of them.
private enum Kernel: String, CaseIterable {
    case ios = "iOS"
    case android = "Android"

    func boxes(forSigma sigma: Double) -> [UInt32] {
        switch self {
        case .ios:
            return GaussianBlur.boxSizes(forSigma: sigma)
        case .android:
            var boxes = [UInt32](repeating: 0, count: Int(NITRO_BLUR_PASSES))
            nitro_blur_box_sizes(sigma, &boxes)
            return boxes
        }
    }

    func blur(_ image: CGImage, sigma: Double) -> Bitmap {
        switch self {
        case .ios:
            return readPixels(of: GaussianBlur.convolve(image, boxes: boxes(forSigma: sigma))!)
        case .android:
            var bitmap = readPixels(of: image)
            let status = bitmap.bytes.withUnsafeMutableBufferPointer { buffer in
                nitro_blur_premultiplied_8888(
                    buffer.baseAddress, UInt32(bitmap.width), UInt32(bitmap.height),
                    bitmap.width * 4, sigma
                )
            }
            precondition(status == 0, "Android blur kernel failed with status \(status)")
            return bitmap
        }
    }
}

@main
struct VerifyBlur {
    static var failures: [String] = []

    static func check(_ condition: Bool, _ message: String) {
        if !condition { failures.append(message) }
    }

    /// The derivative of a blurred step edge is the blur kernel, so its second
    /// moment is the sigma the kernel actually applied.
    fileprivate static func measuredSigma(forSigma sigma: Double, kernel: Kernel) -> Double {
        let size = 601
        let edge = makeImage(size: size) { column, _ in
            let value: UInt8 = column < size / 2 ? 255 : 0
            return Pixel(alpha: 255, red: value, green: value, blue: value)
        }
        let blurred = kernel.blur(edge, sigma: sigma)
        let row = size / 2

        // Plain loops rather than zip/reduce chains: heavily inferred
        // expressions have tripped "type of expression is ambiguous" on older
        // Swift compilers than the one this is developed against.
        var totalWeight: Double = 0
        var weightedSum: Double = 0
        var samples: [(position: Double, weight: Double)] = []
        for column in 0..<(blurred.width - 1) {
            let here = Double(blurred.pixel(column: column, row: row).red)
            let next = Double(blurred.pixel(column: column + 1, row: row).red)
            let position = Double(column) + 0.5
            let weight = here - next
            samples.append((position: position, weight: weight))
            totalWeight += weight
            weightedSum += position * weight
        }

        let mean: Double = weightedSum / totalWeight
        var variance: Double = 0
        for sample in samples {
            let offset = sample.position - mean
            variance += offset * offset * sample.weight
        }
        variance /= totalWeight
        return variance.squareRoot()
    }

    static func checkSigmaIsHonoured() {
        print("Requested sigma vs. measured sigma of a blurred step edge:")
        print("     sigma            boxes     iOS measured        err     Android measured        err")
        let targets: [Double] = [1, 2, 3, 5, 8, 11, 20, 40]
        for sigma in targets {
            let iosBoxes = Kernel.ios.boxes(forSigma: sigma)
            let androidBoxes = Kernel.android.boxes(forSigma: sigma)
            check(
                iosBoxes == androidBoxes,
                "sigma \(sigma): iOS boxes \(iosBoxes) != Android boxes \(androidBoxes)"
            )
            let ios = measuredSigma(forSigma: sigma, kernel: .ios)
            let android = measuredSigma(forSigma: sigma, kernel: .android)
            print(String(
                format: "%10.1f %16@ %16.3f %10.3f %20.3f %10.3f",
                sigma, "\(iosBoxes)" as NSString, ios, ios - sigma, android, android - sigma
            ))
            // Box widths are odd integers, so sigma lands on a coarse grid;
            // half a pixel is the worst that quantisation can cost.
            for (kernel, measured) in [(Kernel.ios, ios), (Kernel.android, android)] {
                check(
                    (measured - sigma).magnitude <= 0.5,
                    "\(kernel.rawValue) sigma \(sigma): measured \(measured), off by more than 0.5px"
                )
            }
            // The same boxes on the same edge: the kernels may differ only by
            // 8-bit rounding, which is far below the quantisation above.
            check(
                (ios - android).magnitude <= 0.01,
                "sigma \(sigma): iOS measured \(ios) but Android measured \(android)"
            )
        }
    }

    /// Regression test for the edge fade: a fully opaque image, blurred, has to
    /// come back fully opaque — including the corners.
    static func checkOpaqueEdgesSurviveBlur() {
        let size = 128
        let solid = Pixel(alpha: 255, red: 200, green: 120, blue: 60)
        let image = makeImage(size: size) { _, _ in solid }
        print("\nOpaque \(size)x\(size) image blurred at sigma 40:")
        for kernel in Kernel.allCases {
            // A sigma wider than the image itself is the harshest case: every
            // output pixel is then reached by the border.
            let blurred = kernel.blur(image, sigma: 40)

            var translucent = 0
            var faded = 0
            for row in 0..<blurred.height {
                for column in 0..<blurred.width {
                    let pixel = blurred.pixel(column: column, row: row)
                    if pixel.alpha != 255 { translucent += 1 }
                    // Blurring a constant image gives back that same constant
                    // image; anything else means the kernel mixed in what lies
                    // outside it.
                    if (Int(pixel.red) - Int(solid.red)).magnitude > 1
                        || (Int(pixel.green) - Int(solid.green)).magnitude > 1
                        || (Int(pixel.blue) - Int(solid.blue)).magnitude > 1 {
                        faded += 1
                    }
                }
            }

            print("  \(kernel.rawValue): translucent pixels: \(translucent), faded pixels: \(faded)")
            check(translucent == 0, "\(kernel.rawValue) blur made \(translucent) pixels translucent")
            check(faded == 0, "\(kernel.rawValue) blur faded \(faded) pixels toward the frame")
        }
    }

    /// The two kernels run on the same photo-like image have to produce the
    /// same bytes — exactly: both round once per pass, so nothing is left
    /// to rounding differences.
    static func checkKernelsAgreePixelwise() {
        let size = 257
        // A gradient with a checkerboard, a hard edge, and a translucent band
        // (premultiplied), so every part of the kernel is exercised — including
        // the alpha channel and the borders.
        let image = makeImage(size: size) { column, row in
            let checker = ((column / 9) + (row / 9)) % 2 == 0
            var red = UInt8(clamping: column)
            var green = UInt8(clamping: row)
            var blue: UInt8 = checker ? 220 : 40
            if column > size * 3 / 4 { red = 255 - red; green = 20 }
            var alpha: UInt8 = 255
            if row > size * 2 / 3 {
                alpha = 96
                red = UInt8(Int(red) * 96 / 255)
                green = UInt8(Int(green) * 96 / 255)
                blue = UInt8(Int(blue) * 96 / 255)
            }
            return Pixel(alpha: alpha, red: red, green: green, blue: blue)
        }
        print("\nPixel-wise agreement on a \(size)x\(size) synthetic photo:")
        print("     sigma     max diff    pixels differing")
        for sigma in [4.0, 12.0, 30.0] {
            let ios = Kernel.ios.blur(image, sigma: sigma)
            let android = Kernel.android.blur(image, sigma: sigma)
            var maxDiff = 0
            var differing = 0
            for index in 0..<ios.bytes.count {
                let diff = Int((Int(ios.bytes[index]) - Int(android.bytes[index])).magnitude)
                if diff > maxDiff { maxDiff = diff }
                // `BLUR_DEBUG=1 bun run verify:blur` prints where they differ.
                if diff > 0 && ProcessInfo.processInfo.environment["BLUR_DEBUG"] != nil {
                    let pixel = index / 4
                    print(
                        "  diff \(diff) at column \(pixel % size) row \(pixel / size)"
                            + " channel \(index % 4): iOS \(ios.bytes[index]) Android \(android.bytes[index])"
                    )
                }
                if diff != 0 { differing += 1 }
            }
            print(String(format: "%10.1f %12d %18d", sigma, maxDiff, differing))
            check(maxDiff == 0, "sigma \(sigma): kernels differ by up to \(maxDiff) levels")
        }
    }

    static func main() {
        checkSigmaIsHonoured()
        checkOpaqueEdgesSurviveBlur()
        checkKernelsAgreePixelwise()

        if failures.isEmpty {
            print("\nAll blur checks passed.")
        } else {
            print("\n\(failures.count) blur check(s) FAILED:")
            failures.forEach { print("  - \($0)") }
            exit(1)
        }
    }
}
