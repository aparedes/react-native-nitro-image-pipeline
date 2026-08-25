import type { Image } from 'react-native-nitro-image';
import type { HybridObject } from 'react-native-nitro-modules';

export type CacheOption = 'memory' | 'disk' | 'none';

/**
 * Independent corner radii in points. Omitted corners stay square.
 */
export interface CornerRadii {
  topLeft?: number;
  topRight?: number;
  bottomLeft?: number;
  bottomRight?: number;
}

export type Options = {
  /**
   * Gaussian blur strength, given as the standard deviation (sigma) of the
   * blur in **source-image pixels**. The same value on the same source image
   * produces the same result on iOS and Android.
   *
   * React Native's `<Image blurRadius={n} />` is roughly `blur: n / 2`.
   *
   * @default 0 (no blur)
   */
  blur?: number;
  cache?: CacheOption;
  /**
   * Corner radius in points, baked into the loaded bitmap. Pass a single
   * number to round all four corners uniformly, or a {@linkcode CornerRadii}
   * object to round each corner independently (e.g. a "ticket" shape with
   * larger bottom corners).
   *
   * @default 0 (square corners)
   */
  cornerRadius?: number | CornerRadii;
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

  clearCache(): Promise<void>;
}
