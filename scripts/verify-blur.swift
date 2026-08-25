//
//  verify-blur.swift
//
//  Host-side checks for the blur kernel in ios/GaussianBlur.swift. Run with:
//
//      bun run verify:blur
//
//  Two properties are asserted:
//
//  1. `blur`/`gaussianBlur` is a Gaussian sigma in source-image pixels. The
//     measured sigma of a blurred step edge has to match the requested one,
//     which is what keeps iOS and Android agreeing on the same number.
//  2. Blurring an opaque image leaves its edges opaque and unchanged. The old
//     CIGaussianBlur path sampled transparent black outside the image, so
//     blurred images faded out at their borders.
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
    let bytes: [UInt8]

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

private func blur(_ image: CGImage, sigma: Double) -> Bitmap {
    readPixels(of: GaussianBlur.convolve(image, boxes: GaussianBlur.boxSizes(forSigma: sigma))!)
}

@main
struct VerifyBlur {
    static var failures: [String] = []

    static func check(_ condition: Bool, _ message: String) {
        if !condition { failures.append(message) }
    }

    /// The derivative of a blurred step edge is the blur kernel, so its second
    /// moment is the sigma the kernel actually applied.
    static func measuredSigma(forSigma sigma: Double) -> Double {
        let size = 601
        let edge = makeImage(size: size) { column, _ in
            let value: UInt8 = column < size / 2 ? 255 : 0
            return Pixel(alpha: 255, red: value, green: value, blue: value)
        }
        let blurred = blur(edge, sigma: sigma)
        let row = size / 2

        var positions: [Double] = []
        var weights: [Double] = []
        for column in 0..<(blurred.width - 1) {
            let here = Double(blurred.pixel(column: column, row: row).red)
            let next = Double(blurred.pixel(column: column + 1, row: row).red)
            positions.append(Double(column) + 0.5)
            weights.append(here - next)
        }

        let total = weights.reduce(0, +)
        let mean = zip(positions, weights).reduce(0) { $0 + $1.0 * $1.1 } / total
        let variance = zip(positions, weights).reduce(0) {
            $0 + ($1.0 - mean) * ($1.0 - mean) * $1.1
        } / total
        return variance.squareRoot()
    }

    static func checkSigmaIsHonoured() {
        print("Requested sigma vs. measured sigma of a blurred step edge:")
        print("     sigma            boxes     measured        err")
        for sigma in [1.0, 2, 3, 5, 8, 11, 20, 40] {
            let boxes = GaussianBlur.boxSizes(forSigma: sigma)
            let measured = measuredSigma(forSigma: sigma)
            print(String(
                format: "%10.1f %16@ %12.3f %10.3f",
                sigma, "\(boxes)" as NSString, measured, measured - sigma
            ))
            // Box widths are odd integers, so sigma lands on a coarse grid;
            // half a pixel is the worst that quantisation can cost.
            check(
                abs(measured - sigma) <= 0.5,
                "sigma \(sigma): measured \(measured), off by more than 0.5px"
            )
        }
    }

    /// Regression test for the edge fade: a fully opaque image, blurred, has to
    /// come back fully opaque — including the corners.
    static func checkOpaqueEdgesSurviveBlur() {
        let size = 128
        let solid = Pixel(alpha: 255, red: 200, green: 120, blue: 60)
        let image = makeImage(size: size) { _, _ in solid }
        // A sigma wider than the image itself is the harshest case: every
        // output pixel is then reached by the border.
        let blurred = blur(image, sigma: 40)

        var translucent = 0
        var faded = 0
        for row in 0..<blurred.height {
            for column in 0..<blurred.width {
                let pixel = blurred.pixel(column: column, row: row)
                if pixel.alpha != 255 { translucent += 1 }
                // Blurring a constant image gives back that same constant
                // image; anything else means the kernel mixed in what lies
                // outside it.
                if abs(Int(pixel.red) - Int(solid.red)) > 1
                    || abs(Int(pixel.green) - Int(solid.green)) > 1
                    || abs(Int(pixel.blue) - Int(solid.blue)) > 1 {
                    faded += 1
                }
            }
        }

        print("\nOpaque \(size)x\(size) image blurred at sigma 40:")
        print("  translucent pixels: \(translucent)")
        print("  faded pixels:       \(faded)")
        check(translucent == 0, "blur made \(translucent) pixels translucent")
        check(faded == 0, "blur faded \(faded) pixels toward the frame")
    }

    static func main() {
        checkSigmaIsHonoured()
        checkOpaqueEdgesSurviveBlur()

        if failures.isEmpty {
            print("\nAll blur checks passed.")
        } else {
            print("\n\(failures.count) blur check(s) FAILED:")
            failures.forEach { print("  - \($0)") }
            exit(1)
        }
    }
}
