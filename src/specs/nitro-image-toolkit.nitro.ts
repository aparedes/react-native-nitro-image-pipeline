import type { Image } from 'react-native-nitro-image';
import type { HybridObject } from 'react-native-nitro-modules';

export interface NitroImageToolkit
  extends HybridObject<{ ios: 'swift'; android: 'kotlin' }> {
  gaussianBlur(image: Image, radius: number): Promise<Image>;
  // Future: brightness, saturation, tint, etc.

  // Cache — two-tier (in-memory L1 + disk L2)
  getCached(key: string): Promise<Image | undefined>;
  cache(image: Image, key: string): Promise<void>;
  evict(key: string): Promise<void>;
  clearCache(): Promise<void>;

  // Cache config
  setMaxDiskCacheSize(bytes: number): void;
  setMaxMemoryCacheCount(count: number): void;
  getDiskCacheSize(): Promise<number>;
}
