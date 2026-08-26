import {
  PixelRatio,
  type StyleProp,
  StyleSheet,
  type ViewStyle,
} from 'react-native';

import type {
  CornerRadii,
  ResizeOptions,
} from './specs/nitro-image-toolkit.nitro';

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

/**
 * Derives a `cornerRadius` option from a view style's `borderRadius` /
 * `borderTopLeftRadius` / `borderTopRightRadius` / `borderBottomLeftRadius` /
 * `borderBottomRightRadius`, in points. Per-corner properties override
 * `borderRadius` for that corner; a corner with neither set stays square.
 * Non-numeric values (percentages, animated values) are ignored, like
 * {@linkcode resizeForStyle}. Returns `undefined` when none are set.
 */
export function cornerRadiusForStyle(
  style: StyleProp<ViewStyle>,
): number | CornerRadii | undefined {
  const flat = StyleSheet.flatten(style);
  const base =
    typeof flat?.borderRadius === 'number' ? flat.borderRadius : undefined;
  const topLeft =
    typeof flat?.borderTopLeftRadius === 'number'
      ? flat.borderTopLeftRadius
      : undefined;
  const topRight =
    typeof flat?.borderTopRightRadius === 'number'
      ? flat.borderTopRightRadius
      : undefined;
  const bottomLeft =
    typeof flat?.borderBottomLeftRadius === 'number'
      ? flat.borderBottomLeftRadius
      : undefined;
  const bottomRight =
    typeof flat?.borderBottomRightRadius === 'number'
      ? flat.borderBottomRightRadius
      : undefined;

  if (
    topLeft === undefined &&
    topRight === undefined &&
    bottomLeft === undefined &&
    bottomRight === undefined
  ) {
    return base;
  }

  return {
    topLeft: topLeft ?? base,
    topRight: topRight ?? base,
    bottomLeft: bottomLeft ?? base,
    bottomRight: bottomRight ?? base,
  };
}
