import type { Image } from 'react-native-nitro-image';
import type { HybridObject } from 'react-native-nitro-modules';

type CacheOption = 'memory' | 'disk' | 'none';
type Options = { blur?: number; cache?: CacheOption; cornerRadius?: number };

export interface NitroImagePipeline
  extends HybridObject<{ ios: 'swift'; android: 'kotlin' }> {
  loadImage(url: string, options?: Options): Promise<Image>;
  preLoadImage(url: string): Promise<void>;
  preLoadImages(urls: string[]): Promise<void>;
  gaussianBlur(image: Image, radius: number): Promise<Image>;
  // Future: brightness, saturation, tint, etc.

  clearCache(): void;
}
