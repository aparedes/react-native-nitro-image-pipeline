//
//  HybridNitroImagePipeline.swift
//  Pods
//
//  Created by Alejandro Paredes Alva on 3/31/2026.
//

import Foundation
import NitroModules
import NitroImage
import Nuke

import UIKit
import CoreImage

private class HybridImage: HybridImageSpec, NativeImage {
    let uiImage: UIImage

    // PNG encoding is expensive; encode once and reuse for both
    // toArrayBuffer() and toBase64().
    private lazy var pngData: Data? = uiImage.pngData()

    init(uiImage: UIImage) {
        self.uiImage = uiImage
        super.init()
    }

    var width: Double {
        return Double(uiImage.size.width)
    }

    var height: Double {
        return Double(uiImage.size.height)
    }

    func toArrayBuffer() throws -> ArrayBuffer {
        guard let data = pngData else {
            throw RuntimeError.error(withMessage: "Failed to encode image to PNG")
        }
        return try ArrayBuffer.copy(data: data)
    }

    func toBase64() throws -> String {
        guard let data = pngData else {
            throw RuntimeError.error(withMessage: "Failed to encode image")
        }

        return data.base64EncodedString()
    }

    var description: String {
        return "HybridImage(\(width)x\(height))"
    }
}

class HybridNitroImagePipeline: HybridNitroImagePipelineSpec {
    // A private pipeline (instead of mutating ImagePipeline.shared) so the
    // prefetcher and loadImage read/write the exact same caches, and other
    // Nuke users in the host app are left untouched.
    private let pipeline: ImagePipeline
    private let prefetcher: ImagePrefetcher

    // CIContext is expensive to create; Apple recommends reusing one.
    private static let ciContext = CIContext()

    override init() {
        var configuration = ImagePipeline.Configuration.withDataCache
        // Store processed (blurred/rounded) variants on disk too, not just
        // the original download, so they survive memory eviction and restarts.
        configuration.dataCachePolicy = .automatic
        let pipeline = ImagePipeline(configuration: configuration)
        self.pipeline = pipeline
        self.prefetcher = ImagePrefetcher(pipeline: pipeline)
        super.init()
    }

    func loadImage(url: String, options: Options?) throws -> Promise<any HybridImageSpec> {
        return Promise.async {
            guard let imageUrl = URL(string: url) else {
                throw RuntimeError.error(withMessage: "Invalid URL: \(url)")
            }

            let cacheOptions: ImageRequest.Options = switch options?.cache {
            case .memory: [.disableDiskCache]
            case .disk:   [.disableMemoryCache]
            case .none?:  [.disableDiskCache, .disableMemoryCache]
            default:      []
            }

            var processors: [any ImageProcessing] = []
            if let blur = options?.blur, blur > 0 {
                processors.append(.gaussianBlur(radius: Int(blur)))
            }
            if let cornerRadius = options?.cornerRadius, cornerRadius > 0 {
                processors.append(.roundedCorners(radius: cornerRadius))
            }

            let imgRequest = ImageRequest(
                url: imageUrl,
                processors: processors,
                options: cacheOptions
            )

            let image = try await self.pipeline.image(for: imgRequest)
            return HybridImage(uiImage: image)
        }
    }

    func preLoadImage(url: String) throws -> Promise<Void> {
        return Promise.async {
            guard let imageUrl = URL(string: url) else {
                throw RuntimeError.error(withMessage: "Invalid URL: \(url)")
            }

            self.prefetcher.startPrefetching(with: [imageUrl])
        }
    }

    func preLoadImages(urls: [String]) throws -> Promise<Void> {
        return Promise.async {
            let imageUrls = urls.compactMap { URL(string: $0) }
            self.prefetcher.startPrefetching(with: imageUrls)
        }
    }

    func clearCache() throws {
        pipeline.cache.removeAll()
    }

    func gaussianBlur(image: any HybridImageSpec, radius: Double) throws -> Promise<any HybridImageSpec> {
        return Promise.async {
            guard let nativeImage = image as? NativeImage else {
                throw RuntimeError.error(withMessage: "Unsupported image type")
            }

            let uiImage = nativeImage.uiImage

            guard let ciImage = CIImage(image: uiImage) else {
                throw RuntimeError.error(withMessage: "Failed to read image data")
            }

            let filter = CIFilter(name: "CIGaussianBlur")!
            filter.setValue(ciImage, forKey: kCIInputImageKey)
            filter.setValue(radius, forKey: kCIInputRadiusKey)

            guard let output = filter.outputImage,
                  let cgImage = Self.ciContext.createCGImage(output, from: ciImage.extent) else {
                throw RuntimeError.error(withMessage: "Failed to apply gaussian blur")
            }

            return HybridImage(uiImage: UIImage(cgImage: cgImage))
        }
    }

}
