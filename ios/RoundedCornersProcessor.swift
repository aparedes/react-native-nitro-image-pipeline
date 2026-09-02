//
//  RoundedCornersProcessor.swift
//  NitroImagePipeline
//
//  Bakes independent per-corner radii into the bitmap. Nuke's built-in
//  ImageProcessors.RoundedCorners only supports one uniform radius, so the
//  asymmetric case clips through a hand-built CGPath instead.
//

import CoreGraphics
import Foundation
import Nuke
import UIKit

/// Nuke processor that rounds each corner with its own radius, measured in
/// pixels of the bitmap it receives (like `ImageProcessors.RoundedCorners`
/// with `unit: .points` on the scale-1 images the pipeline decodes). Runs
/// after `ImageProcessors.Resize` when `Options.resize` is set, so the radii
/// refer to the final output size.
struct RoundedCornersProcessor: ImageProcessing {
    let topLeft: CGFloat
    let topRight: CGFloat
    let bottomLeft: CGFloat
    let bottomRight: CGFloat

    init(radii: CornerRadii) {
        // Negative radii would make CGPath arcs undefined; treat them as square.
        topLeft = CGFloat(max(radii.topLeft ?? 0, 0))
        topRight = CGFloat(max(radii.topRight ?? 0, 0))
        bottomLeft = CGFloat(max(radii.bottomLeft ?? 0, 0))
        bottomRight = CGFloat(max(radii.bottomRight ?? 0, 0))
    }

    var hasRounding: Bool {
        topLeft > 0 || topRight > 0 || bottomLeft > 0 || bottomRight > 0
    }

    var identifier: String {
        "com.nitroimagepipeline.roundedCorners?tl=\(topLeft),tr=\(topRight),bl=\(bottomLeft),br=\(bottomRight)"
    }

    var hashableIdentifier: AnyHashable { identifier }

    func process(_ image: PlatformImage) -> PlatformImage? {
        let size = image.size
        guard size.width > 0, size.height > 0 else { return image }

        let format = UIGraphicsImageRendererFormat()
        format.scale = image.scale
        format.opaque = false
        // `.automatic` picks the extended (16-bit-per-channel) range on
        // wide-gamut displays, which doubles the bytes of this bitmap — the
        // one that ends up in the memory cache and on screen — for an 8-bit
        // sRGB source that gains nothing from it.
        format.preferredRange = .standard

        let rect = CGRect(origin: .zero, size: size)
        return UIGraphicsImageRenderer(size: size, format: format).image { context in
            context.cgContext.addPath(Self.clipPath(
                in: rect,
                topLeft: topLeft,
                topRight: topRight,
                bottomLeft: bottomLeft,
                bottomRight: bottomRight
            ))
            context.cgContext.clip()
            image.draw(in: rect)
        }
    }

    /// A rounded-rect outline with independent corner radii, clamped the way
    /// CSS `border-radius` clamps: if two radii on one edge overlap, all four
    /// scale down proportionally until they fit.
    static func clipPath(
        in rect: CGRect,
        topLeft: CGFloat,
        topRight: CGFloat,
        bottomLeft: CGFloat,
        bottomRight: CGFloat
    ) -> CGPath {
        var scale: CGFloat = 1
        for (edge, pair) in [
            (rect.width, topLeft + topRight),
            (rect.width, bottomLeft + bottomRight),
            (rect.height, topLeft + bottomLeft),
            (rect.height, topRight + bottomRight)
        ] where pair > edge {
            scale = min(scale, edge / pair)
        }
        let topLeft = topLeft * scale
        let topRight = topRight * scale
        let bottomLeft = bottomLeft * scale
        let bottomRight = bottomRight * scale

        // addArc(tangent1End:tangent2End:radius: 0) degenerates to a line
        // through the corner, so square corners need no special-casing.
        let path = CGMutablePath()
        path.move(to: CGPoint(x: rect.minX + topLeft, y: rect.minY))
        path.addLine(to: CGPoint(x: rect.maxX - topRight, y: rect.minY))
        path.addArc(
            tangent1End: CGPoint(x: rect.maxX, y: rect.minY),
            tangent2End: CGPoint(x: rect.maxX, y: rect.minY + topRight),
            radius: topRight
        )
        path.addLine(to: CGPoint(x: rect.maxX, y: rect.maxY - bottomRight))
        path.addArc(
            tangent1End: CGPoint(x: rect.maxX, y: rect.maxY),
            tangent2End: CGPoint(x: rect.maxX - bottomRight, y: rect.maxY),
            radius: bottomRight
        )
        path.addLine(to: CGPoint(x: rect.minX + bottomLeft, y: rect.maxY))
        path.addArc(
            tangent1End: CGPoint(x: rect.minX, y: rect.maxY),
            tangent2End: CGPoint(x: rect.minX, y: rect.maxY - bottomLeft),
            radius: bottomLeft
        )
        path.addLine(to: CGPoint(x: rect.minX, y: rect.minY + topLeft))
        path.addArc(
            tangent1End: CGPoint(x: rect.minX, y: rect.minY),
            tangent2End: CGPoint(x: rect.minX + topLeft, y: rect.minY),
            radius: topLeft
        )
        path.closeSubpath()
        return path
    }
}
