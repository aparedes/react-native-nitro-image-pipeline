//
//  PipelineImageLoader.swift
//  NitroImagePipeline
//

import Foundation
import NitroImage
import NitroModules
import Nuke
import UIKit

/// An `ImageLoader` (react-native-nitro-image) backed by the shared pipeline.
///
/// `<NativeNitroImage image={loader} />` drives it entirely natively: the view
/// calls `requestImage` when it attaches to a window and `dropImage` when it
/// detaches. The load runs at the view's laid-out size (× screen scale) with
/// no JS round trips, and detaching cancels the request and releases the
/// bitmap — the decoded image stays in the shared memory/disk caches, so
/// re-attaching (list recycling) is instant.
///
/// `ViewOptions` values are in points; this class converts them to the
/// pixel-based `Options` of the shared request builder using the view's
/// display scale, so cache keys match an equivalent `loadImage` call.
class PipelineImageLoader: HybridImageLoaderSpec {
    private let url: String
    private let options: ViewOptions?

    // Per-view in-flight work, keyed by the view's identity, so a loader
    // shared between several views cancels only the right request. Confined
    // to the main thread — every access happens inside a main-queue block.
    private var tasks: [ObjectIdentifier: Task<Void, Never>] = [:]
    private var pendingLayouts: [ObjectIdentifier: NSKeyValueObservation] = [:]

    init(url: String, options: ViewOptions?) {
        self.url = url
        self.options = options
    }

    private var pipeline: ImagePipeline { HybridNitroImagePipeline.sharedPipeline }

    /// visionOS has no `UIScreen.main`; there UIKit reports 2.0 as the
    /// display scale of trait environments.
    private static var fallbackScale: CGFloat {
        #if os(visionOS)
        return 2.0
        #else
        return UIScreen.main.scale
        #endif
    }

    private static func displayScale(of view: UIView) -> CGFloat {
        let scale = view.traitCollection.displayScale
        // 0 means "unspecified" (view not in a hierarchy yet).
        return scale > 0 ? scale : fallbackScale
    }

    /// The point-based `ViewOptions` as pixel-based `Options`, resolved
    /// against `scale` and the target size in pixels.
    private func pixelOptions(scale: CGFloat, sizePx: CGSize?) -> Options {
        let cornerRadius = options?.cornerRadius.map { radius -> Variant_Double_CornerRadii in
            switch radius {
            case .first(let uniform):
                return .first(uniform * scale)
            case .second(let radii):
                return .second(CornerRadii(
                    topLeft: radii.topLeft.map { $0 * scale },
                    topRight: radii.topRight.map { $0 * scale },
                    bottomLeft: radii.bottomLeft.map { $0 * scale },
                    bottomRight: radii.bottomRight.map { $0 * scale }
                ))
            }
        }
        return Options(
            blur: options?.blur.map { $0 * scale },
            cache: options?.cache,
            cornerRadius: cornerRadius,
            resize: sizePx.map { ResizeOptions(width: Double($0.width), height: Double($0.height)) }
        )
    }

    /// An explicit `resize` override (pixels), when set and valid.
    private var explicitResize: CGSize? {
        guard let resize = options?.resize, resize.width > 0, resize.height > 0 else {
            return nil
        }
        return CGSize(width: resize.width, height: resize.height)
    }

    // MARK: - ImageLoader

    func loadImage() throws -> Promise<any HybridImageSpec> {
        return Promise.async {
            guard let imageUrl = HybridNitroImagePipeline.url(from: self.url) else {
                throw RuntimeError.error(withMessage: "Invalid URL: \(self.url)")
            }
            // No view to measure here: use the explicit resize if given, and
            // the main screen's scale for the point-based options.
            let scale = await MainActor.run { Self.fallbackScale }
            let request = HybridNitroImagePipeline.makeRequest(
                url: imageUrl,
                options: self.pixelOptions(scale: scale, sizePx: self.explicitResize)
            )
            let image = try await self.pipeline.image(for: request)
            return HybridImage(uiImage: image)
        }
    }

    func requestImage(forView view: any HybridNitroImageViewSpec) throws {
        guard let nativeView = view as? NativeImageView else { return }
        let key = ObjectIdentifier(view)
        // Always hop (asynchronously) to main: `requestImage` fires while the
        // view is being mounted, and only after the current mounting
        // transaction finishes is its final frame guaranteed to be set.
        DispatchQueue.main.async {
            self.load(into: nativeView.imageView, key: key)
        }
    }

    func dropImage(forView view: any HybridNitroImageViewSpec) throws {
        guard let nativeView = view as? NativeImageView else { return }
        let key = ObjectIdentifier(view)
        // Same queue as `requestImage`, so rapid attach/detach sequences
        // (list recycling) replay in call order.
        DispatchQueue.main.async {
            self.cancel(key: key)
            nativeView.imageView.image = nil
        }
    }

    // MARK: - Main-thread loading

    private func cancel(key: ObjectIdentifier) {
        tasks[key]?.cancel()
        tasks[key] = nil
        // Releasing the observation invalidates it.
        pendingLayouts[key] = nil
    }

    private func load(into imageView: UIImageView, key: ObjectIdentifier) {
        cancel(key: key)

        if let sizePx = explicitResize {
            start(into: imageView, key: key, sizePx: sizePx)
            return
        }

        let bounds = imageView.bounds.size
        if bounds.width > 0, bounds.height > 0 {
            let scale = Self.displayScale(of: imageView)
            start(into: imageView, key: key, sizePx: CGSize(
                width: bounds.width * scale,
                height: bounds.height * scale
            ))
        } else {
            // Mounted at zero size (e.g. a flex child before its container
            // grows): wait for real bounds. Observed on the layer — CALayer
            // properties are KVO-compliant, UIView's are not.
            pendingLayouts[key] = imageView.layer.observe(\.bounds) { [weak self, weak imageView] layer, _ in
                guard layer.bounds.width > 0, layer.bounds.height > 0 else { return }
                DispatchQueue.main.async {
                    guard let self, let imageView else { return }
                    guard self.pendingLayouts[key] != nil else { return }
                    self.load(into: imageView, key: key)
                }
            }
        }
    }

    private func start(into imageView: UIImageView, key: ObjectIdentifier, sizePx: CGSize) {
        guard let imageUrl = HybridNitroImagePipeline.url(from: url) else { return }
        let scale = Self.displayScale(of: imageView)
        let request = HybridNitroImagePipeline.makeRequest(
            url: imageUrl,
            options: pixelOptions(scale: scale, sizePx: sizePx)
        )
        let pipeline = self.pipeline
        // A memory-cache hit is served synchronously. Going through
        // `pipeline.image(for:)` would resume on Nuke's queue and then hop
        // back to the main actor, so a recycled cell (whose image `dropImage`
        // just cleared) would show empty for a frame or two even though the
        // bitmap is already in memory. The subscript honours the request's
        // `.disableMemoryCacheReads`, so `cache: 'disk'`/`'none'` still miss.
        if !request.options.contains(.disableMemoryCacheReads), let cached = pipeline.cache[request] {
            imageView.image = cached.image
            return
        }
        // Cancelling the Task cancels Nuke's request; a finished task stays in
        // the map (cancelling it is a no-op) until `cancel` replaces it.
        tasks[key] = Task { @MainActor [weak imageView] in
            guard let image = try? await pipeline.image(for: request) else { return }
            guard !Task.isCancelled else { return }
            imageView?.image = image
        }
    }
}
