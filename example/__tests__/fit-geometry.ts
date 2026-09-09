import type { ResizeFit } from 'react-native-nitro-image-pipeline';

/**
 * The resize geometry the native sides implement — `FitGeometry` in
 * `ios/FitResizeProcessor.swift` and `android/.../transform/FitGeometry.kt`.
 * The suites compute their expected sizes from this copy, so one table
 * checks both platforms against the same contract:
 * ```
 * cover   : sx = sy = max(W/w, H/h)
 * contain : sx = sy = min(W/w, H/h)
 * stretch : sx = W/w ; sy = H/h
 * center  : sx = sy = 1
 * if !allowUpscale: sx = min(sx, 1) ; sy = min(sy, 1)
 * scaled  = (round(w·sx), round(h·sy))
 * output  = (min(W, scaled.w), min(H, scaled.h))
 * ```
 * `Math.round` rounds halves up, like Kotlin's `roundToInt()` and Swift's
 * `.rounded()` do for the positive values involved.
 */
export function fitGeometry(
  sourceWidth: number,
  sourceHeight: number,
  boxWidth: number,
  boxHeight: number,
  fit: ResizeFit,
  allowUpscale = true,
): { width: number; height: number } {
  const W = Math.round(boxWidth);
  const H = Math.round(boxHeight);
  let sx: number;
  let sy: number;
  switch (fit) {
    case 'cover':
      sx = sy = Math.max(W / sourceWidth, H / sourceHeight);
      break;
    case 'contain':
      sx = sy = Math.min(W / sourceWidth, H / sourceHeight);
      break;
    case 'stretch':
      sx = W / sourceWidth;
      sy = H / sourceHeight;
      break;
    case 'center':
      sx = sy = 1;
      break;
  }
  if (!allowUpscale) {
    sx = Math.min(sx, 1);
    sy = Math.min(sy, 1);
  }
  const scaledWidth = Math.max(Math.round(sourceWidth * sx), 1);
  const scaledHeight = Math.max(Math.round(sourceHeight * sy), 1);
  return {
    width: Math.min(W, scaledWidth),
    height: Math.min(H, scaledHeight),
  };
}
