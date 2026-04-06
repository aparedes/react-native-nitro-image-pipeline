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
        guard let data = uiImage.pngData() else {
            throw RuntimeError.error(withMessage: "Failed to encode image to PNG")
        }
        return try ArrayBuffer.copy(data: data)
    }

    func toBase64() throws -> String {
        guard let data = uiImage.pngData() else {
            throw RuntimeError.error(withMessage: "Failed to encode image")
        }

        return data.base64EncodedString()
    }

    var description: String {
        return "HybridImage(\(width)x\(height))"
    }
}

class HybridNitroImagePipeline: HybridNitroImagePipelineSpec {
    private let prefetcher = ImagePrefetcher()

    override init() {
        ImagePipeline.shared = ImagePipeline(configuration: .withDataCache)
    }

    func loadImage(url: String, options: Options?) throws -> Promise<any HybridImageSpec> {
        return Promise.async {
            let cacheOptions: ImageRequest.Options = switch options?.cache {
            case .memory: [.disableDiskCache]
            case .disk:   [.disableMemoryCache]
            case .none?:  [.disableDiskCache, .disableMemoryCache]
            default:      []
            }

            let imgRequest = ImageRequest(
                url: URL(string: url),
                processors: [
                    .gaussianBlur(radius: Int(options?.blur ?? 0)),
                    .roundedCorners(radius: options?.cornerRadius ?? 0)
                ], options: cacheOptions
            )

            let image = try await ImagePipeline.shared.image(for: imgRequest)
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
        ImagePipeline.shared.cache.removeAll()
    }

    func gaussianBlur(image: any HybridImageSpec, radius: Double) throws -> Promise<any HybridImageSpec> {
        return Promise.async {
            guard let nativeImage = image as? NativeImage else {
                throw RuntimeError.error(withMessage: "Unsupported image type")
            }

            let uiImage = nativeImage.uiImage

            let ciImage = CIImage(image: uiImage)

            let filter = CIFilter(name: "CIGaussianBlur")!
            filter.setValue(ciImage, forKey: kCIInputImageKey)
            filter.setValue(radius, forKey: kCIInputRadiusKey)

            let context = CIContext()
            let output = filter.outputImage
            let cgImage = context.createCGImage(output!, from: ciImage!.extent)

            return HybridImage(uiImage: UIImage(cgImage: cgImage!))
        }
    }

}
