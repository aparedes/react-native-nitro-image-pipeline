//
//  FitResizeProcessor.swift
//  NitroImagePipeline
//
//  Resizes into the `ResizeOptions` box under any `fit` other than the
//  default. The default — `cover` with upscaling — stays on Nuke's own
//  `ImageProcessors.Resize(.aspectFill, crop: true)`, so its output bytes and
//  cache keys are exactly what they were before `fit` existed.
//

import CoreGraphics
import Foundation
import Nuke
import UIKit

/// The resize geometry both platforms implement — Android's port is
/// `transform/FitGeometry.kt`, and `example/__tests__/fit-geometry.ts` is the
/// copy the harness checks both against. With a `w` × `h` source and a
/// `W` × `H` box:
///
/// ```
/// cover   : sx = sy = max(W/w, H/h)
/// contain : sx = sy = min(W/w, H/h)
/// stretch : sx = W/w ; sy = H/h
/// center  : sx = sy = 1
/// if !allowUpscale: sx = min(sx, 1) ; sy = min(sy, 1)
/// scaled  = (round(w·sx), round(h·sy))
/// output  = (min(W, scaled.w), min(H, scaled.h))
/// origin  = trunc((output − scaled) / 2)        — a centred, whole-pixel crop
/// ```
///
/// The source is drawn scaled to `scaled` at `origin` on an `output`-sized
/// canvas. Rounding is half-away-from-zero (`.rounded()` here,
/// `roundToInt()` in Kotlin — identical for the positive values involved).
struct FitGeometry: Equatable {
    let scaled: CGSize
    let output: CGSize
    let origin: CGPoint

    init(source: CGSize, box: CGSize, fit: ResizeFit, allowUpscale: Bool) {
        let boxWidth = box.width.rounded()
        let boxHeight = box.height.rounded()
        var scaleX: CGFloat
        var scaleY: CGFloat
        switch fit {
        case .cover:
            let scale = max(boxWidth / source.width, boxHeight / source.height)
            scaleX = scale
            scaleY = scale
        case .contain:
            let scale = min(boxWidth / source.width, boxHeight / source.height)
            scaleX = scale
            scaleY = scale
        case .stretch:
            scaleX = boxWidth / source.width
            scaleY = boxHeight / source.height
        case .center:
            scaleX = 1
            scaleY = 1
        }
        if !allowUpscale {
            scaleX = min(scaleX, 1)
            scaleY = min(scaleY, 1)
        }
        let scaledWidth = max((source.width * scaleX).rounded(), 1)
        let scaledHeight = max((source.height * scaleY).rounded(), 1)
        let outputWidth = min(boxWidth, scaledWidth)
        let outputHeight = min(boxHeight, scaledHeight)
        scaled = CGSize(width: scaledWidth, height: scaledHeight)
        output = CGSize(width: outputWidth, height: outputHeight)
        origin = CGPoint(
            x: ((outputWidth - scaledWidth) / 2).rounded(.towardZero),
            y: ((outputHeight - scaledHeight) / 2).rounded(.towardZero)
        )
    }

    /// Whether the source is already the output — nothing to draw.
    var isIdentity: Bool { scaled == output && origin == .zero }
}

/// Nuke processor for the non-default fits. Runs before the blur and corner
/// processors, like `ImageProcessors.Resize`, so their pixel units refer to
/// the produced bitmap. Sizes are in points of the image, which the pipeline
/// decodes at scale 1 (1 pt = 1 px) — the same convention as
/// `RoundedCornersProcessor`.
struct FitResizeProcessor: ImageProcessing {
    let width: Double
    let height: Double
    let fit: ResizeFit
    let allowUpscale: Bool

    var identifier: String {
        "com.nitroimagepipeline.resize?w=\(width),h=\(height),fit=\(fit.stringValue),upscale=\(allowUpscale)"
    }

    var hashableIdentifier: AnyHashable { identifier }

    func process(_ image: PlatformImage) -> PlatformImage? {
        let source = image.size
        guard source.width > 0, source.height > 0 else { return image }
        let geometry = FitGeometry(
            source: source,
            box: CGSize(width: width, height: height),
            fit: fit,
            allowUpscale: allowUpscale
        )
        // `center` of a source that fits the box, or `contain` without
        // upscaling of a small source: the bitmap is already the output.
        if geometry.isIdentity { return image }

        let format = UIGraphicsImageRendererFormat()
        format.scale = image.scale
        format.opaque = false
        // See RoundedCornersProcessor: the extended range doubles the bytes
        // of an 8-bit source for nothing.
        format.preferredRange = .standard

        return UIGraphicsImageRenderer(size: geometry.output, format: format).image { _ in
            image.draw(in: CGRect(origin: geometry.origin, size: geometry.scaled))
        }
    }
}
