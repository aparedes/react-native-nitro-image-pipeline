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

private class HybridImage: HybridImageSpec, NativeImage {
    let uiImage: UIImage

    // PNG encoding is expensive; encode once and reuse for both
    // toArrayBuffer() and toBase64(). Guarded by a lock (lazy var is not
    // thread-safe) and dropped on memory pressure so a JS-retained image
    // doesn't pin its encoding forever.
    private let pngLock = NSLock()
    private var cachedPngData: Data?
    private var memoryWarningObserver: (any NSObjectProtocol)?

    init(uiImage: UIImage) {
        self.uiImage = uiImage
        super.init()
        memoryWarningObserver = NotificationCenter.default.addObserver(
            forName: UIApplication.didReceiveMemoryWarningNotification,
            object: nil,
            queue: nil
        ) { [weak self] _ in
            guard let self else { return }
            self.pngLock.lock()
            self.cachedPngData = nil
            self.pngLock.unlock()
        }
    }

    deinit {
        if let memoryWarningObserver {
            NotificationCenter.default.removeObserver(memoryWarningObserver)
        }
    }

    private func pngData() -> Data? {
        pngLock.lock()
        defer { pngLock.unlock() }
        if let cachedPngData {
            return cachedPngData
        }
        let data = uiImage.pngData()
        cachedPngData = data
        return data
    }

    var width: Double {
        return Double(uiImage.size.width)
    }

    var height: Double {
        return Double(uiImage.size.height)
    }

    func toArrayBuffer() throws -> ArrayBuffer {
        guard let data = pngData() else {
            throw RuntimeError.error(withMessage: "Failed to encode image to PNG")
        }
        return try ArrayBuffer.copy(data: data)
    }

    func toBase64() throws -> String {
        guard let data = pngData() else {
            throw RuntimeError.error(withMessage: "Failed to encode image")
        }

        return data.base64EncodedString()
    }

    var description: String {
        return "HybridImage(\(width)x\(height))"
    }
}

class HybridNitroImagePipeline: HybridNitroImagePipelineSpec {
    // One shared pipeline (instead of mutating ImagePipeline.shared) so the
    // prefetcher and loadImage read/write the exact same caches, other Nuke
    // users in the host app are left untouched, and repeated instantiation
    // (e.g. Metro reloads) never puts two DataCache instances on the same
    // directory.
    private static let sharedPipeline: ImagePipeline = {
        var configuration = ImagePipeline.Configuration.withDataCache
        // Store processed (blurred/rounded) variants on disk in addition to
        // the original download, so they survive memory eviction and
        // restarts without dropping the original for other variants.
        configuration.dataCachePolicy = .storeAll
        // A private, capped memory cache. The default (ImageCache.shared)
        // sizes itself at 15% of physical RAM — up to 768 MB of decoded
        // bitmaps on modern devices before anything is evicted, which shows
        // up as "high RAM usage" even though it is all evictable cache.
        // 128 MB still holds ~10 full-screen bitmaps or hundreds of list
        // thumbnails, and the LRU cache keeps trimming itself on memory
        // warnings and when the app enters the background.
        configuration.imageCache = ImageCache(
            costLimit: min(ImageCache.defaultCostLimit, 128 * 1024 * 1024)
        )
        return ImagePipeline(configuration: configuration)
    }()

    // `.diskCache` stores the downloaded data without decoding it, so
    // prefetching N URLs costs network + disk I/O instead of N decoded
    // full-resolution bitmaps parked in the memory cache (the default
    // `.memoryCache` destination). The image is decoded — at the requested
    // target size — only when a loadImage actually displays it.
    private static let sharedPrefetcher = ImagePrefetcher(
        pipeline: sharedPipeline,
        destination: .diskCache
    )

    private var pipeline: ImagePipeline { Self.sharedPipeline }
    private var prefetcher: ImagePrefetcher { Self.sharedPrefetcher }

    private static func cacheOptions(for cache: CacheOption?) -> ImageRequest.Options {
        switch cache {
        case .memory: [.disableDiskCache]
        case .disk:   [.disableMemoryCache]
        case .none?:  [.disableDiskCache, .disableMemoryCache]
        default:      []
        }
    }

    /// The processor that bakes `cornerRadius` into the bitmap, or `nil` when
    /// no corner is actually rounded.
    private static func cornerRadiusProcessor(
        for cornerRadius: Variant_Double_CornerRadii?
    ) -> (any ImageProcessing)? {
        switch cornerRadius {
        case .first(let radius):
            guard radius > 0 else { return nil }
            // `unit: .pixels` is required: Nuke defaults to `.points`, which
            // multiplies the radius by the screen scale. The radius is
            // documented — and implemented on Android and in
            // RoundedCornersProcessor — as bitmap pixels.
            return ImageProcessors.RoundedCorners(radius: radius, unit: .pixels)
        case .second(let radii):
            let roundedCorners = RoundedCornersProcessor(radii: radii)
            return roundedCorners.hasRounding ? roundedCorners : nil
        case nil:
            return nil
        }
    }

    /// The target size in pixels, or `nil` when no (valid) resize was requested.
    private static func resizeSize(for options: Options?) -> CGSize? {
        guard let resize = options?.resize, resize.width > 0, resize.height > 0 else {
            return nil
        }
        return CGSize(width: resize.width, height: resize.height)
    }

    private static func processors(for options: Options?) -> [any ImageProcessing] {
        var processors: [any ImageProcessing] = []
        // Resize first: blur sigma and corner radii are defined in pixels
        // of the bitmap they run on, so they must see the final size.
        if let size = resizeSize(for: options) {
            processors.append(ImageProcessors.Resize(
                size: size,
                unit: .pixels,
                contentMode: .aspectFill,
                crop: true,
                upscale: true
            ))
        }
        if let blur = options?.blur, blur > 0 {
            processors.append(GaussianBlurProcessor(sigma: blur))
        }
        if let roundedCorners = cornerRadiusProcessor(for: options?.cornerRadius) {
            processors.append(roundedCorners)
        }
        return processors
    }

    func loadImage(url: String, options: Options?) throws -> Promise<any HybridImageSpec> {
        return Promise.async {
            guard let imageUrl = URL(string: url) else {
                throw RuntimeError.error(withMessage: "Invalid URL: \(url)")
            }

            var imgRequest = ImageRequest(
                url: imageUrl,
                processors: Self.processors(for: options),
                options: Self.cacheOptions(for: options?.cache)
            )
            // With a target size known, decode near it (aspect-fill, so the
            // decoded image always covers the target) instead of at full
            // resolution — a 48 MP photo displayed as a 300 pt card would
            // otherwise decompress to ~190 MB before Resize shrinks it.
            // Matches Android, where the request's size() drives subsampling;
            // the exact size and crop still come from the Resize processor.
            if let size = Self.resizeSize(for: options) {
                imgRequest.thumbnail = ImageRequest.ThumbnailOptions(
                    size: size,
                    unit: .pixels,
                    contentMode: .aspectFill
                )
            }

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

    func clearCache() throws -> Promise<Void> {
        return Promise.async {
            self.pipeline.cache.removeAll()
        }
    }

    func gaussianBlur(image: any HybridImageSpec, radius: Double) throws -> Promise<any HybridImageSpec> {
        return Promise.async {
            guard let nativeImage = image as? NativeImage else {
                throw RuntimeError.error(withMessage: "Unsupported image type")
            }

            guard let blurred = GaussianBlur.apply(to: nativeImage.uiImage, sigma: radius) else {
                throw RuntimeError.error(withMessage: "Failed to apply gaussian blur")
            }

            return HybridImage(uiImage: blurred)
        }
    }

}
