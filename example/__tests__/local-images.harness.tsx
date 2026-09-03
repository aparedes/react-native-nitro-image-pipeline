import { screen } from '@react-native-harness/ui';
import { StyleSheet, Text } from 'react-native';
import {
  beforeAll,
  describe,
  expect,
  it,
  render,
  waitFor,
} from 'react-native-harness';
import type { Image } from 'react-native-nitro-image';
import {
  NativePipelineImage,
  NitroImagePipeline,
  PipelineImage,
  resolveImageUrl,
  UNREGISTERED_ASSET_URL,
  useImage,
} from 'react-native-nitro-image-pipeline';

import { CHECKER_URL, GRADIENT_URL } from './fixture-urls';

// The same 200×200 gradient the fixture server serves, bundled as an asset.
// In the harness (a debug build) Metro streams it, so this exercises the
// `http` branch of the resolution; release builds resolve it to a `file://`
// URL (iOS) or a drawable resource name (Android), which the native loaders
// handle and CI cannot build here.
const GRADIENT_ASSET = require('../fixtures/gradient-200.png');

const styles = StyleSheet.create({
  thumb: { width: 100, height: 50, borderRadius: 12 },
});

function UseImageProbe({ url }: { url: string | number }) {
  const result = useImage({ url });
  if (result.error) return <Text testID="error">{result.error.message}</Text>;
  if (result.image) return <Text testID="loaded">{result.image.width}</Text>;
  return <Text testID="loading">loading</Text>;
}

// A mount can take longer than the harness's default 1 s on a cold CI
// simulator (seen on iOS right after this suite's decode-heavy tests), so give
// renders headroom. The assertions that matter still run through `waitFor`.
const RENDER = { timeout: 5000 };

/**
 * The decoded colour channels as `[R, G, B]` per pixel, whatever the native
 * byte layout. nitro-image exports a raw memory copy whose `pixelFormat`
 * differs per image on iOS — an opaque source comes out as `BGRX`, one with an
 * alpha channel as `BGRA` — so comparing raw buffers would compare layouts,
 * not pixels.
 */
function rgbOf(image: Image): Uint8Array {
  const { buffer, width, height, pixelFormat } = image.toRawPixelData();
  const bytes = new Uint8Array(buffer);
  const bytesPerPixel = bytes.length / (width * height);
  const offsets = ['R', 'G', 'B'].map((channel) =>
    pixelFormat.indexOf(channel),
  );
  if (offsets.some((offset) => offset < 0 || offset >= bytesPerPixel)) {
    throw new Error(`Unexpected pixel format ${pixelFormat}`);
  }
  const rgb = new Uint8Array(width * height * 3);
  for (let pixel = 0; pixel < width * height; pixel++) {
    for (let channel = 0; channel < 3; channel++) {
      rgb[pixel * 3 + channel] =
        bytes[pixel * bytesPerPixel + (offsets[channel] ?? 0)] ?? 0;
    }
  }
  return rgb;
}

describe('local images', () => {
  // A copy of the checkerboard on the file system, written by nitro-image;
  // its path is plain (no `file://`), as `saveToTemporaryFileAsync` returns.
  let checkerPath = '';

  beforeAll(async () => {
    await NitroImagePipeline.clearCache();
    const source = await NitroImagePipeline.loadImage(CHECKER_URL, {
      cache: 'none',
    });
    checkerPath = await source.saveToTemporaryFileAsync('png', 100);
  });

  it('resolveImageUrl passes URL strings through', () => {
    expect(resolveImageUrl(GRADIENT_URL)).toBe(GRADIENT_URL);
    expect(resolveImageUrl('/tmp/photo.jpg')).toBe('/tmp/photo.jpg');
  });

  it('resolveImageUrl resolves a require() to a URL string', () => {
    const url = resolveImageUrl(GRADIENT_ASSET);
    expect(typeof url).toBe('string');
    expect(url.length > 0).toBe(true);
  });

  it('resolveImageUrl rejects an unregistered asset id', () => {
    expect(() => resolveImageUrl(987654321)).toThrow();
  });

  it('loads a require()d asset', async () => {
    const image = await NitroImagePipeline.loadImage(
      resolveImageUrl(GRADIENT_ASSET),
    );
    expect(image.width).toBe(200);
    expect(image.height).toBe(200);
  });

  it('loads a file:// URL', async () => {
    const image = await NitroImagePipeline.loadImage(`file://${checkerPath}`);
    expect(image.width).toBe(200);
    expect(image.height).toBe(200);
  });

  it('loads a plain absolute path', async () => {
    const image = await NitroImagePipeline.loadImage(checkerPath);
    expect(image.width).toBe(200);
    expect(image.height).toBe(200);
  });

  it('applies resize, blur and rounded corners to a local file', async () => {
    const image = await NitroImagePipeline.loadImage(`file://${checkerPath}`, {
      resize: { width: 120, height: 80 },
      blur: 2,
      cornerRadius: 16,
    });
    expect(image.width).toBe(120);
    expect(image.height).toBe(80);
  });

  it('produces the same bitmap from a local file as from the network', async () => {
    // No cornerRadius: the transparent corners would bring alpha
    // premultiplication into a comparison that is about the colour pipeline.
    const options = {
      resize: { width: 90, height: 60 },
      blur: 3,
      cache: 'none' as const,
    };
    const fromNetwork = await NitroImagePipeline.loadImage(
      CHECKER_URL,
      options,
    );
    const fromFile = await NitroImagePipeline.loadImage(
      `file://${checkerPath}`,
      options,
    );
    expect(fromFile.width).toBe(fromNetwork.width);
    expect(fromFile.height).toBe(fromNetwork.height);
    const a = rgbOf(fromNetwork);
    const b = rgbOf(fromFile);
    expect(b.length).toBe(a.length);
    // The re-encoded file carries its own colour profile and the two paths
    // may decode through differently laid-out bitmaps, so allow for colour
    // management rounding — anything more would mean a real pipeline
    // difference.
    let maxDifference = 0;
    for (let i = 0; i < a.length; i++) {
      maxDifference = Math.max(
        maxDifference,
        Math.abs((a[i] ?? 0) - (b[i] ?? 0)),
      );
    }
    expect(maxDifference).toBeLessThanOrEqual(2);
  });

  it('via createImageLoader().loadImage() from a local file', async () => {
    const loader = NitroImagePipeline.createImageLoader(
      `file://${checkerPath}`,
      {
        resize: { width: 120, height: 80 },
        cornerRadius: 8,
      },
    );
    const image = await loader.loadImage();
    expect(image.width).toBe(120);
    expect(image.height).toBe(80);
  });

  it('rejects a missing file', async () => {
    let error: unknown;
    try {
      await NitroImagePipeline.loadImage('file:///definitely/not/here.png');
    } catch (e) {
      error = e;
    }
    expect(error).toBeDefined();
  });

  it('preloading a local file is a no-op that resolves', async () => {
    await NitroImagePipeline.preLoadImage(`file://${checkerPath}`);
    await NitroImagePipeline.preLoadImages([
      `file://${checkerPath}`,
      checkerPath,
    ]);
  });

  it('useImage accepts a require()', async () => {
    await render(<UseImageProbe url={GRADIENT_ASSET} />, RENDER);
    await waitFor(() => expect(screen.queryByTestId('loaded')).toBeDefined());
  });

  it('useImage reports an unregistered asset id as an error', async () => {
    await render(<UseImageProbe url={987654321} />, RENDER);
    await waitFor(() => expect(screen.queryByTestId('error')).toBeDefined());
  });

  it('<PipelineImage> loads a require()', async () => {
    let loaded = false;
    await render(
      <PipelineImage
        url={GRADIENT_ASSET}
        style={styles.thumb}
        onLoad={() => {
          loaded = true;
        }}
      />,
      RENDER,
    );
    await waitFor(() => expect(loaded).toBe(true));
  });

  it('<NativePipelineImage> does not throw for an unregistered asset id', async () => {
    const result = await render(
      <NativePipelineImage url={987654321} style={styles.thumb} />,
      RENDER,
    );
    await new Promise<void>((resolve) => setTimeout(() => resolve(), 500));
    result.unmount();
  });

  it('createImageLoader with an unregistered asset id fails at load time', async () => {
    const loader = NitroImagePipeline.createImageLoader(UNREGISTERED_ASSET_URL);
    let error: unknown;
    try {
      await loader.loadImage();
    } catch (e) {
      error = e;
    }
    expect(error).toBeDefined();
  });

  it('<NativePipelineImage> renders a require() and a file URL', async () => {
    const asset = await render(
      <NativePipelineImage url={GRADIENT_ASSET} style={styles.thumb} />,
      RENDER,
    );
    const file = await render(
      <NativePipelineImage
        url={`file://${checkerPath}`}
        style={styles.thumb}
        blur={1}
      />,
      RENDER,
    );
    await new Promise<void>((resolve) => setTimeout(() => resolve(), 1000));
    asset.unmount();
    file.unmount();
  });
});
