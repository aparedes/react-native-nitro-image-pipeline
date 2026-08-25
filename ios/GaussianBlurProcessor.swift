//
//  GaussianBlurProcessor.swift
//  NitroImagePipeline
//
//  UIImage and Nuke plumbing around the kernel in GaussianBlur.swift.
//

import CoreGraphics
import Foundation
import Nuke
import UIKit

extension GaussianBlur {
    /// Applies a Gaussian blur of standard deviation `sigma` (in image pixels).
    ///
    /// Returns `image` unchanged when `sigma` is too small to affect a pixel,
    /// and `nil` only when the pixel buffers could not be allocated.
    static func apply(to image: UIImage, sigma: Double) -> UIImage? {
        guard sigma > 0, sigma.isFinite, let cgImage = image.cgImage else { return image }

        let boxes = boxSizes(forSigma: sigma)
        guard boxes.contains(where: { $0 > 1 }) else { return image }
        guard let blurred = convolve(cgImage, boxes: boxes) else { return nil }

        return UIImage(cgImage: blurred, scale: image.scale, orientation: image.imageOrientation)
    }
}

/// Nuke processor so `loadImage(url:, { blur })` and `gaussianBlur(image:, sigma)`
/// go through the exact same kernel.
struct GaussianBlurProcessor: ImageProcessing {
    let sigma: Double

    var identifier: String { "com.nitroimagepipeline.gaussianBlur?sigma=\(sigma)" }

    var hashableIdentifier: AnyHashable { identifier }

    func process(_ image: PlatformImage) -> PlatformImage? {
        GaussianBlur.apply(to: image, sigma: sigma)
    }
}
