import type { Image } from 'react-native-nitro-image';

/**
 * The byte offsets of R, G, B and A in a 4-byte pixel of `bytes`.
 *
 * nitro-image's `toRawPixelData` copies a CGImage's memory verbatim and labels
 * it from the image's `alphaInfo` plus an endianness check that treats
 * CoreGraphics' *default* byte order as little-endian. The default is
 * big-endian for 32-bit bitmaps, so an image the pipeline's processors draw
 * (`premultipliedLast`, default order — `RGBA` in memory) comes back labelled
 * `ABGR`: every byte reversed. ImageIO-decoded sources happen to be labelled
 * right. A test that compares a decoded source with a processed result, or
 * reads a processed result's alpha, therefore cannot trust the label alone.
 *
 * The alpha byte is always first or last, and in the harness fixtures it is
 * `255` at every opaque pixel while no colour channel is `255` at more than a
 * few, so the position with more `255`s is the alpha byte. If that disagrees
 * with the label, the label is reversed.
 */
function layoutOf(
  bytes: Uint8Array,
  bytesPerPixel: number,
  pixelFormat: string,
): { r: number; g: number; b: number; a: number } {
  let format = pixelFormat;
  if (bytesPerPixel === 4 && format.length === 4) {
    let first = 0;
    let last = 0;
    for (let offset = 0; offset < bytes.length; offset += 4) {
      if (bytes[offset] === 255) first += 1;
      if (bytes[offset + 3] === 255) last += 1;
    }
    if (first !== last) {
      const detectedAlpha = first > last ? 0 : 3;
      const labelledAlpha = format.indexOf('A');
      if (labelledAlpha >= 0 && labelledAlpha !== detectedAlpha) {
        let reversed = '';
        for (const channel of format) reversed = channel + reversed;
        format = reversed;
      }
    }
  }
  const offsets = ['R', 'G', 'B'].map((channel) => format.indexOf(channel));
  if (offsets.some((offset) => offset < 0 || offset >= bytesPerPixel)) {
    throw new Error(`Unexpected pixel format ${pixelFormat}`);
  }
  const a = format.indexOf('A');
  return {
    r: offsets[0] ?? 0,
    g: offsets[1] ?? 0,
    b: offsets[2] ?? 0,
    a: a >= 0 && a < bytesPerPixel ? a : -1,
  };
}

/**
 * A decoded image as `[R, G, B, A]` per pixel, whatever the native byte
 * layout — see {@linkcode layoutOf} for why the layout is checked rather
 * than read off the label. An image without an alpha channel reads as fully
 * opaque.
 */
export function rgbaOf(image: Image): Uint8Array {
  const { buffer, width, height, pixelFormat } = image.toRawPixelData();
  const bytes = new Uint8Array(buffer);
  const bytesPerPixel = bytes.length / (width * height);
  const layout = layoutOf(bytes, bytesPerPixel, pixelFormat);
  const rgba = new Uint8Array(width * height * 4);
  for (let pixel = 0; pixel < width * height; pixel++) {
    const offset = pixel * bytesPerPixel;
    rgba[pixel * 4] = bytes[offset + layout.r] ?? 0;
    rgba[pixel * 4 + 1] = bytes[offset + layout.g] ?? 0;
    rgba[pixel * 4 + 2] = bytes[offset + layout.b] ?? 0;
    rgba[pixel * 4 + 3] =
      layout.a >= 0 ? (bytes[offset + layout.a] ?? 255) : 255;
  }
  return rgba;
}

/** The colour channels only, `[R, G, B]` per pixel. */
export function rgbOf(image: Image): Uint8Array {
  const rgba = rgbaOf(image);
  const rgb = new Uint8Array((rgba.length / 4) * 3);
  for (let pixel = 0; pixel < rgba.length / 4; pixel++) {
    rgb[pixel * 3] = rgba[pixel * 4] ?? 0;
    rgb[pixel * 3 + 1] = rgba[pixel * 4 + 1] ?? 0;
    rgb[pixel * 3 + 2] = rgba[pixel * 4 + 2] ?? 0;
  }
  return rgb;
}

/** The `[R, G, B, A]` of the pixel at (`x`, `y`) in `rgba` (row-major, `width` wide). */
export function pixelAt(
  rgba: Uint8Array,
  width: number,
  x: number,
  y: number,
): [number, number, number, number] {
  const offset = (y * width + x) * 4;
  return [
    rgba[offset] ?? 0,
    rgba[offset + 1] ?? 0,
    rgba[offset + 2] ?? 0,
    rgba[offset + 3] ?? 0,
  ];
}

/** The largest per-channel difference between two equally sized pixel buffers. */
export function maxDifference(a: Uint8Array, b: Uint8Array): number {
  if (a.length !== b.length) {
    throw new Error(`Buffers differ in length: ${a.length} vs ${b.length}`);
  }
  let max = 0;
  for (let i = 0; i < a.length; i++) {
    max = Math.max(max, Math.abs((a[i] ?? 0) - (b[i] ?? 0)));
  }
  return max;
}
