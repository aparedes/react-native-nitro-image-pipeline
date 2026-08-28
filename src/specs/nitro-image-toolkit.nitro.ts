import type { Image } from 'react-native-nitro-image';
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

export interface NitroImagePipeline extends HybridObject<{
  ios: 'swift';
  android: 'kotlin';
}> {
  loadImage(url: string, options?: Options): Promise<Image>;
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
