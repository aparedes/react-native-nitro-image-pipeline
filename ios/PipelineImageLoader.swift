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
///
/// The optional `onLoad`/`onError` callbacks report a view's load back to JS.
/// They are per request, not per loader: several views (and a recycled cell
/// re-attaching) each call them, and a view that requests twice reports twice.
/// `loadImage()` doesn't — it reports through its promise instead.
class PipelineImageLoader: HybridImageLoaderSpec {
    private let url: String
    private let options: ViewOptions?

    // Per-view in-flight work, keyed by the view's identity, so a loader
    // shared between several views cancels only the right request. Confined
    // to the main thread — every access happens inside a main-queue block.
    private var tasks: [ObjectIdentifier: Task<Void, Never>] = [:]
    private var pendingLayouts: [ObjectIdentifier: NSKeyValueObservation] = [:]
    // Bumped synchronously by every `requestImage`/`dropImage` — the view
    // calls both on the main thread, from its own lifecycle — so work queued
    // by an earlier call can tell a later one superseded it before its
    // main-queue block ran, and neither displays nor reports. `dropImage`
    // only *queues* its cancellation, so without this a request queued just
    // before a detach still runs first and, on a memory-cache hit, reports a
    // load for a view that is about to be cleared.
    private var generations: [ObjectIdentifier: Int] = [:]

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
    /// against `scale` and the target size in pixels. The fit comes from the
    /// explicit `resize` when it carries one, else from the top-level
    /// `fit`/`allowUpscale`, which apply to the measured size.
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
            resize: sizePx.map {
                ResizeOptions(
                    width: Double($0.width),
                    height: Double($0.height),
                    fit: explicitResizeOptions?.fit ?? options?.fit,
                    allowUpscale: explicitResizeOptions?.allowUpscale ?? options?.allowUpscale
                )
            }
        )
    }

    /// The loaded image as the view should draw it. The pipeline decodes at
    /// scale 1 (1 pt = 1 px); `.center` — the one content mode that draws an
    /// image at its point size — would then show a `fit: 'center'` bitmap at
    /// `scale`× its size on a Retina screen, while Android's
    /// `ScaleType.CENTER` draws it pixel for pixel. Re-wrapping with the
    /// display scale (a wrapper around the same CGImage, not a copy) makes
    /// iOS draw 1 bitmap pixel per device pixel too; the scaling content
    /// modes are unaffected by an image's scale.
    private static func displayImage(_ image: UIImage, scale: CGFloat) -> UIImage {
        guard image.scale != scale, let cgImage = image.cgImage else { return image }
        return UIImage(cgImage: cgImage, scale: scale, orientation: image.imageOrientation)
    }

    /// The explicit `resize` override, when set and valid. An invalid one
    /// (a non-positive dimension) is ignored as a whole — its `fit` and
    /// `allowUpscale` included, as on Android — and the view is measured.
    private var explicitResizeOptions: ResizeOptions? {
        guard let resize = options?.resize, resize.width > 0, resize.height > 0 else {
            return nil
        }
        return resize
    }

    /// The explicit `resize` override's size (pixels), when set and valid.
    private var explicitResize: CGSize? {
        explicitResizeOptions.map { CGSize(width: $0.width, height: $0.height) }
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
        let generation = supersedeWork(for: key)
        // Always hop (asynchronously) to main: `requestImage` fires while the
        // view is being mounted, and only after the current mounting
        // transaction finishes is its final frame guaranteed to be set.
        DispatchQueue.main.async {
            guard self.isCurrent(generation, for: key) else { return }
            self.load(into: nativeView.imageView, key: key, generation: generation)
        }
    }

    func dropImage(forView view: any HybridNitroImageViewSpec) throws {
        guard let nativeView = view as? NativeImageView else { return }
        let key = ObjectIdentifier(view)
        // Takes effect now, unlike the cancellation below: a request queued
        // before this drop runs first, and must not load or report.
        _ = supersedeWork(for: key)
        // Same queue as `requestImage`, so rapid attach/detach sequences
        // (list recycling) replay in call order.
        DispatchQueue.main.async {
            self.cancel(key: key)
            nativeView.imageView.image = nil
        }
    }

    // MARK: - Main-thread loading

    /// Invalidates whatever is queued for `key` and returns the token
    /// identifying this new piece of work. Main thread, like its callers.
    private func supersedeWork(for key: ObjectIdentifier) -> Int {
        // Never reset: a token must not be reused while an older block that
        // holds it is still queued.
        let generation = (generations[key] ?? 0) + 1
        generations[key] = generation
        return generation
    }

    private func isCurrent(_ generation: Int, for key: ObjectIdentifier) -> Bool {
        return generations[key] == generation
    }

    private func cancel(key: ObjectIdentifier) {
        tasks[key]?.cancel()
        tasks[key] = nil
        // Releasing the observation invalidates it.
        pendingLayouts[key] = nil
    }

    private func load(into imageView: UIImageView, key: ObjectIdentifier, generation: Int) {
        cancel(key: key)

        if let sizePx = explicitResize {
            start(into: imageView, key: key, generation: generation, sizePx: sizePx)
            return
        }

        let bounds = imageView.bounds.size
        if bounds.width > 0, bounds.height > 0 {
            let scale = Self.displayScale(of: imageView)
            start(into: imageView, key: key, generation: generation, sizePx: CGSize(
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
                    guard self.isCurrent(generation, for: key) else { return }
                    self.load(into: imageView, key: key, generation: generation)
                }
            }
        }
    }

    private func start(
        into imageView: UIImageView,
        key: ObjectIdentifier,
        generation: Int,
        sizePx: CGSize
    ) {
        guard let imageUrl = HybridNitroImagePipeline.url(from: url) else {
            // Android's loader hands a malformed URL to Coil, which reports it
            // as a failed request; report it here too rather than returning
            // silently and leaving `onError` waiting forever.
            options?.onError?("Invalid URL: \(url)")
            return
        }
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
            imageView.image = Self.displayImage(cached.image, scale: scale)
            notifyLoad(cached.image)
            return
        }
        // Cancelling the Task cancels Nuke's request; a finished task stays in
        // the map (cancelling it is a no-op) until `cancel` replaces it.
        tasks[key] = Task { @MainActor [weak self, weak imageView] in
            do {
                let image = try await pipeline.image(for: request)
                guard !Task.isCancelled else { return }
                guard self?.isCurrent(generation, for: key) == true else { return }
                imageView?.image = Self.displayImage(image, scale: scale)
                self?.notifyLoad(image)
            } catch {
                // A load the view cancelled by detaching is not a failure.
                guard !Task.isCancelled, !(error is CancellationError) else { return }
                guard self?.isCurrent(generation, for: key) == true else { return }
                self?.options?.onError?(error.localizedDescription)
            }
        }
    }

    /// Reports the displayed bitmap's size in pixels, when the caller asked
    /// for it. `UIImage.size` is in points, so it needs the image's own scale.
    private func notifyLoad(_ image: UIImage) {
        guard let onLoad = options?.onLoad else { return }
        onLoad(image.size.width * image.scale, image.size.height * image.scale)
    }
}
