import {
  PixelRatio,
  type StyleProp,
  StyleSheet,
  type ViewStyle,
} from 'react-native';

import type { ResizeOptions } from './specs/nitro-image-toolkit.nitro';

/**
 * Converts a layout size in points (dp) to the pipeline's `resize` option in
 * whole bitmap pixels using `PixelRatio.getPixelSizeForLayoutSize`. Returns
 * `undefined` unless both values are positive numbers.
 */
export function resizeForLayout(
  width: unknown,
  height: unknown,
): ResizeOptions | undefined {
  if (typeof width !== 'number' || typeof height !== 'number') {
    return undefined;
  }
  const pixelWidth = PixelRatio.getPixelSizeForLayoutSize(width);
  const pixelHeight = PixelRatio.getPixelSizeForLayoutSize(height);
  return pixelWidth > 0 && pixelHeight > 0
    ? { width: pixelWidth, height: pixelHeight }
    : undefined;
}

/**
 * Derives the pipeline's `resize` option from a view style whose `width` and
 * `height` are numeric points, so the bitmap matches the display size on
 * every screen density:
 * ```ts
 * useImage({ url, resize: resizeForStyle(styles.image) });
 * ```
 * Arrays and registered styles are flattened. Returns `undefined` when either
 * dimension is missing or not a number (`'50%'`, `'auto'`, flex-driven) —
 * use `<PipelineImage>` for those, which measures the view instead.
 */
export function resizeForStyle(
  style: StyleProp<ViewStyle>,
): ResizeOptions | undefined {
  const flat = StyleSheet.flatten(style);
  return resizeForLayout(flat?.width, flat?.height);
}
