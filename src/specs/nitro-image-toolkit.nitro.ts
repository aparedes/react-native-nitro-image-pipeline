import type { Image, ImageLoader } from 'react-native-nitro-image';
import type { HybridObject } from 'react-native-nitro-modules';

export type CacheOption = 'memory' | 'disk' | 'none';

/**
 * Independent corner radii, in pixels of the loaded bitmap (see
 * {@linkcode Options.cornerRadius}). Omitted corners stay square.
 */
export interface CornerRadii {
  topLeft?: number;
  topRight?: number;
  bottomLeft?: number;
  bottomRight?: number;
}

/**
 * Target bitmap size in pixels. The image is scaled to fill this size and
 * center-cropped (like CSS `object-fit: cover`), upscaling if needed, so the
 * result is exactly `width` × `height` pixels.
 */
export interface ResizeOptions {
  width: number;
  height: number;
}

export type Options = {
  /**
   * Gaussian blur strength, given as the standard deviation (sigma) of the
   * blur in **source-image pixels**. The same value on the same source image
   * produces the same result on iOS and Android.
   *
   * When {@linkcode resize} is set, the blur runs after resizing, so sigma is
   * in pixels of the resized bitmap instead.
   *
   * React Native's `<Image blurRadius={n} />` is roughly `blur: n / 2`.
   *
   * @default 0 (no blur)
   */
  blur?: number;
  cache?: CacheOption;
  /**
   * Corner radius baked into the loaded bitmap, in **pixels of that bitmap**.
   * Pass a single number to round all four corners uniformly, or a
   * {@linkcode CornerRadii} object to round each corner independently (e.g. a
   * "ticket" shape with larger bottom corners).
   *
   * Without {@linkcode resize} the radius applies to the full-resolution
   * source image, so on a large photo displayed small the rounding shrinks
   * along with it. To get corners sized for your layout, pass `resize` with
   * your display size in pixels (points × screen scale) — the radii then
   * apply to that final bitmap, 1:1 with what you see.
   *
   * @default 0 (square corners)
   */
  cornerRadius?: number | CornerRadii;
  /**
   * Resize the image to exactly this size in pixels (aspect-fill,
   * center-crop) before `blur` and `cornerRadius` are applied. Besides making
   * `cornerRadius` predictable, this avoids decoding and processing
   * full-resolution bitmaps you only display small.
   *
   * @default undefined (keep the source size)
   */
  resize?: ResizeOptions;
};

/**
 * Options for {@linkcode NitroImagePipeline.createImageLoader}. Unlike
 * {@linkcode Options} (used by `loadImage`, where values are bitmap pixels),
 * everything here is in **points** (density-independent): the loader runs
 * inside a view and converts to pixels natively with the screen scale.
 */
export type ViewOptions = {
  /**
   * Gaussian blur sigma in **points**. Multiplied by the screen scale
   * natively, so the same value looks the same on every device.
   * @default 0 (no blur)
   */
  blur?: number;
  cache?: CacheOption;
  /**
   * Corner radius in **points**, uniform or per-corner. Converted to pixels
   * with the screen scale and baked into the bitmap at the display size.
   * @default 0 (square corners)
   */
  cornerRadius?: number | CornerRadii;
  /**
   * Target bitmap size in **pixels**, overriding the size measured from the
   * view. Rarely needed — without it the loader resizes to the view's
   * laid-out size × screen scale, which is what you want in a UI.
   * @default undefined (measure the view)
   */
  resize?: ResizeOptions;
};

export interface NitroImagePipeline extends HybridObject<{
  ios: 'swift';
  android: 'kotlin';
}> {
  loadImage(url: string, options?: Options): Promise<Image>;
  /**
   * Creates an {@linkcode ImageLoader} for `url` that a `<NativeNitroImage>`
   * view drives entirely natively: the request starts when the view attaches
   * to the window — at the view's own laid-out size, with no JS round trips —
   * and is cancelled (and the bitmap released) when it detaches, so
   * off-screen list cells stop costing memory. Loads go through the same
   * pipeline and caches as {@linkcode loadImage}/{@linkcode preLoadImage}.
   *
   * `options` are in **points** (see {@linkcode ViewOptions}); the loader
   * applies the screen scale natively. If the view has no size yet when it
   * attaches, the load waits for its first layout.
   */
  createImageLoader(url: string, options?: ViewOptions): ImageLoader;
  preLoadImage(url: string): Promise<void>;
  preLoadImages(urls: string[]): Promise<void>;
  /**
   * Blurs an already-loaded image. `radius` is the standard deviation (sigma)
   * of the Gaussian in **source-image pixels**, the same unit as
   * {@linkcode Options.blur}.
   */
  gaussianBlur(image: Image, radius: number): Promise<Image>;
  // Future: brightness, saturation, tint, etc.

  /**
   * Caps the in-memory cache of decoded bitmaps at `bytes`, evicting
   * least-recently-used entries immediately if it is currently larger. Pass
   * `0` to disable in-memory caching entirely (the disk cache still works).
   *
   * Defaults: 128 MB on iOS, 25% of the app's memory class on Android. The
   * cache trades RAM for instant re-display; lower it (or use
   * `cache: 'disk'` per request) in memory-constrained apps.
   */
  setMemoryCacheLimit(bytes: number): void;

  clearCache(): Promise<void>;
}
