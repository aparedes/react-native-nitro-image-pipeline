//
//  OpaqueImageEncoder.swift
//  NitroImagePipeline
//
//  What the disk cache keeps of a processed image.
//

import CoreGraphics
import Foundation
import Nuke

/// Encodes a processed image for the disk cache (`dataCachePolicy = .storeAll`)
/// only when it is opaque — as JPEG, through Nuke's default encoder. An image
/// with an alpha channel encodes to nothing, which Nuke takes as "don't store":
/// it is rebuilt from the cached download the next time it is needed.
///
/// Nuke's default writes anything with alpha as PNG, and here that is every
/// rounded, blurred and non-`cover` result. Measured over 150 photos, a
/// rounded 402x402 px thumbnail was a 257 kB PNG — more than the 1200x1200 px
/// JPEG it was made from — that took 4.3 ms to encode and saved 5.5 ms on a
/// later launch; at 1206x1206 px it was 2 MB, took 28.5 ms and saved nothing,
/// and a list of them pushed the original downloads out of the cache. The
/// JPEG of an opaque resize is a fifth of the size and saves more.
struct OpaqueImageEncoder: ImageEncoding {
    private let encoder = ImageEncoders.Default()

    func encode(_ image: PlatformImage) -> Data? {
        guard let cgImage = image.cgImage, Self.isOpaque(cgImage) else { return nil }
        return encoder.encode(image)
    }

    /// Whether `image` has no alpha channel — the test Nuke's default encoder
    /// uses to pick JPEG over PNG.
    static func isOpaque(_ image: CGImage) -> Bool {
        switch image.alphaInfo {
        case .none, .noneSkipFirst, .noneSkipLast: true
        default: false
        }
    }
}
