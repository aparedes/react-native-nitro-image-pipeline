import type { Image } from 'react-native-nitro-image';
import type { HybridObject } from 'react-native-nitro-modules';

export type CacheOption = 'memory' | 'disk' | 'none';
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
  cornerRadius?: number;
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
