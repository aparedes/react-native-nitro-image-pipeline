import type { Image } from 'react-native-nitro-image';

/**
 * A decoded image as `[R, G, B, A]` per pixel, whatever the native byte
 * layout. nitro-image exports a raw memory copy whose `pixelFormat` differs
 * per image on iOS — an opaque source comes out as `BGRX`, one with an alpha
 * channel as `BGRA` — so comparing raw buffers would compare layouts, not
 * pixels. An image without an alpha channel reads as fully opaque.
 */
export function rgbaOf(image: Image): Uint8Array {
  const { buffer, width, height, pixelFormat } = image.toRawPixelData();
  const bytes = new Uint8Array(buffer);
  const bytesPerPixel = bytes.length / (width * height);
  const offsets = ['R', 'G', 'B'].map((channel) =>
    pixelFormat.indexOf(channel),
  );
  if (offsets.some((offset) => offset < 0 || offset >= bytesPerPixel)) {
    throw new Error(`Unexpected pixel format ${pixelFormat}`);
  }
  const alphaOffset = pixelFormat.indexOf('A');
  const rgba = new Uint8Array(width * height * 4);
  for (let pixel = 0; pixel < width * height; pixel++) {
    for (let channel = 0; channel < 3; channel++) {
      rgba[pixel * 4 + channel] =
        bytes[pixel * bytesPerPixel + (offsets[channel] ?? 0)] ?? 0;
    }
    rgba[pixel * 4 + 3] =
      alphaOffset >= 0 && alphaOffset < bytesPerPixel
        ? (bytes[pixel * bytesPerPixel + alphaOffset] ?? 255)
        : 255;
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
