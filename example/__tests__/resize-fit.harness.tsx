import { PixelRatio, StyleSheet } from 'react-native';
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
  type ResizeFit,
} from 'react-native-nitro-image-pipeline';

import { fitGeometry } from './fit-geometry';
import { CHECKER_URL, GRADIENT_URL } from './fixture-urls';
import { maxDifference, pixelAt, rgbaOf, rgbOf } from './pixels';

const px = (points: number) => PixelRatio.getPixelSizeForLayoutSize(points);

const FITS: ResizeFit[] = ['cover', 'contain', 'stretch', 'center'];

const styles = StyleSheet.create({
  fixed: { width: 100, height: 50 },
});

type Size = { width: number; height: number };
const sizeOf = (image: Image): Size => ({
  width: image.width,
  height: image.height,
});

describe('resize fit', () => {
  // A 200×100 source, made by the pipeline from the 200×200 checkerboard and
  // written to a file — the fixtures are square, and every fit but `stretch`
  // only shows its hand on a non-square one.
  let wideUrl = '';

  beforeAll(async () => {
    // Processed results are cached on disk; a warm cache would hand back an
    // earlier build's output without running the processors.
    await NitroImagePipeline.clearCache();
    const wide = await NitroImagePipeline.loadImage(CHECKER_URL, {
      resize: { width: 200, height: 100 },
      cache: 'none',
    });
    expect(sizeOf(wide)).toEqual({ width: 200, height: 100 });
    wideUrl = `file://${await wide.saveToTemporaryFileAsync('png', 100)}`;
  });

  describe('output size matrix', () => {
    const sources = [
      { name: '200×200', url: () => GRADIENT_URL, width: 200, height: 200 },
      { name: '200×100', url: () => wideUrl, width: 200, height: 100 },
    ];
    const boxes: [number, number][] = [
      [40, 40],
      [120, 80],
      [300, 400],
    ];

    for (const source of sources) {
      for (const [width, height] of boxes) {
        for (const fit of FITS) {
          it(`${fit}: ${source.name} into ${width}×${height}`, async () => {
            const image = await NitroImagePipeline.loadImage(source.url(), {
              resize: { width, height, fit },
            });
            expect(sizeOf(image)).toEqual(
              fitGeometry(source.width, source.height, width, height, fit),
            );
          });
        }
      }

      // Only a box larger than the source can upscale; 300×400 is the one.
      for (const fit of FITS) {
        it(`${fit}, allowUpscale: false: ${source.name} into 300×400`, async () => {
          const image = await NitroImagePipeline.loadImage(source.url(), {
            resize: { width: 300, height: 400, fit, allowUpscale: false },
          });
          expect(sizeOf(image)).toEqual(
            fitGeometry(source.width, source.height, 300, 400, fit, false),
          );
        });
      }
    }

    it('matches the documented examples', () => {
      // The table in the README / spec, with a 2000×1000 and a 100×50 source.
      expect(fitGeometry(2000, 1000, 400, 400, 'cover')).toEqual({
        width: 400,
        height: 400,
      });
      expect(fitGeometry(2000, 1000, 400, 400, 'contain')).toEqual({
        width: 400,
        height: 200,
      });
      expect(fitGeometry(2000, 1000, 400, 400, 'stretch')).toEqual({
        width: 400,
        height: 400,
      });
      expect(fitGeometry(2000, 1000, 400, 400, 'center')).toEqual({
        width: 400,
        height: 400,
      });
      expect(fitGeometry(100, 50, 400, 400, 'contain')).toEqual({
        width: 400,
        height: 200,
      });
      expect(fitGeometry(100, 50, 400, 400, 'contain', false)).toEqual({
        width: 100,
        height: 50,
      });
      expect(fitGeometry(100, 50, 400, 400, 'center')).toEqual({
        width: 100,
        height: 50,
      });
      expect(fitGeometry(100, 50, 400, 400, 'cover', false)).toEqual({
        width: 100,
        height: 50,
      });
    });
  });

  describe('pixels', () => {
    it('the default is cover with upscaling, byte for byte', async () => {
      // `cache: 'none'` so the second load really runs the processors again
      // instead of returning the first result under the same key.
      const implicit = await NitroImagePipeline.loadImage(GRADIENT_URL, {
        resize: { width: 120, height: 80 },
        cache: 'none',
      });
      const explicit = await NitroImagePipeline.loadImage(GRADIENT_URL, {
        resize: { width: 120, height: 80, fit: 'cover', allowUpscale: true },
        cache: 'none',
      });
      expect(sizeOf(explicit)).toEqual(sizeOf(implicit));
      expect(maxDifference(rgbOf(explicit), rgbOf(implicit))).toBe(0);
    });

    it('center is a crop of the source, not a resample', async () => {
      const source = await NitroImagePipeline.loadImage(CHECKER_URL, {
        cache: 'none',
      });
      const centered = await NitroImagePipeline.loadImage(CHECKER_URL, {
        resize: { width: 120, height: 80, fit: 'center' },
        cache: 'none',
      });
      expect(sizeOf(centered)).toEqual({ width: 120, height: 80 });
      const full = rgbaOf(source);
      const crop = rgbaOf(centered);
      // The 120×80 window centred in the 200×200 source starts at (40, 60).
      let worst = 0;
      for (let y = 0; y < 80; y++) {
        for (let x = 0; x < 120; x++) {
          const expected = pixelAt(full, 200, x + 40, y + 60);
          const actual = pixelAt(crop, 120, x, y);
          for (let channel = 0; channel < 3; channel++) {
            worst = Math.max(
              worst,
              Math.abs((expected[channel] ?? 0) - (actual[channel] ?? 0)),
            );
          }
        }
      }
      // The crop is drawn through a renderer the source never went through,
      // so allow for colour-management rounding; a resample of the
      // checkerboard (20 px squares) would be off by ~200 at every edge.
      expect(worst).toBeLessThanOrEqual(8);
    });

    it('contain of a square source is the same picture as a square cover', async () => {
      const contained = await NitroImagePipeline.loadImage(GRADIENT_URL, {
        resize: { width: 120, height: 80, fit: 'contain' },
        cache: 'none',
      });
      const covered = await NitroImagePipeline.loadImage(GRADIENT_URL, {
        resize: { width: 80, height: 80 },
        cache: 'none',
      });
      expect(sizeOf(contained)).toEqual({ width: 80, height: 80 });
      // Two resamplers (Nuke's own for cover, the pipeline's for contain)
      // may round a smooth gradient slightly differently; a crop or a
      // stretch of it would differ by far more.
      expect(
        maxDifference(rgbOf(contained), rgbOf(covered)),
      ).toBeLessThanOrEqual(16);
    });

    it('stretch shows the whole source where cover crops it', async () => {
      const stretched = await NitroImagePipeline.loadImage(wideUrl, {
        resize: { width: 80, height: 80, fit: 'stretch' },
        cache: 'none',
      });
      const covered = await NitroImagePipeline.loadImage(wideUrl, {
        resize: { width: 80, height: 80, fit: 'cover' },
        cache: 'none',
      });
      expect(sizeOf(stretched)).toEqual({ width: 80, height: 80 });
      expect(sizeOf(covered)).toEqual({ width: 80, height: 80 });
      expect(maxDifference(rgbOf(stretched), rgbOf(covered))).toBeGreaterThan(
        16,
      );
    });
  });

  describe('with the other options', () => {
    it('cornerRadius rounds the contained bitmap, not the box', async () => {
      // Android's Coil RoundedCornersTransformation scale-fills to the request
      // size on its own; under contain the pipeline must round at the
      // produced 80×80 instead of inflating the result back to 120×80.
      const image = await NitroImagePipeline.loadImage(CHECKER_URL, {
        resize: { width: 120, height: 80, fit: 'contain' },
        cornerRadius: 16,
      });
      expect(sizeOf(image)).toEqual({ width: 80, height: 80 });
      const rgba = rgbaOf(image);
      expect(pixelAt(rgba, 80, 0, 0)[3]).toBe(0);
      expect(pixelAt(rgba, 80, 79, 79)[3]).toBe(0);
      expect(pixelAt(rgba, 80, 40, 40)[3]).toBe(255);
    });

    it('per-corner radii under center', async () => {
      const image = await NitroImagePipeline.loadImage(CHECKER_URL, {
        resize: { width: 120, height: 80, fit: 'center' },
        cornerRadius: { topLeft: 24 },
      });
      expect(sizeOf(image)).toEqual({ width: 120, height: 80 });
      const rgba = rgbaOf(image);
      expect(pixelAt(rgba, 120, 0, 0)[3]).toBe(0);
      expect(pixelAt(rgba, 120, 119, 0)[3]).toBe(255);
      expect(pixelAt(rgba, 120, 0, 79)[3]).toBe(255);
      expect(pixelAt(rgba, 120, 119, 79)[3]).toBe(255);
    });

    it('blur runs on the contained bitmap', async () => {
      const plain = await NitroImagePipeline.loadImage(CHECKER_URL, {
        resize: { width: 120, height: 80, fit: 'contain' },
      });
      const blurred = await NitroImagePipeline.loadImage(CHECKER_URL, {
        resize: { width: 120, height: 80, fit: 'contain' },
        blur: 4,
      });
      expect(sizeOf(blurred)).toEqual({ width: 80, height: 80 });
      expect(maxDifference(rgbOf(blurred), rgbOf(plain))).toBeGreaterThan(16);
    });
  });

  describe('createImageLoader', () => {
    it('applies a top-level fit to an explicit resize', async () => {
      const loader = NitroImagePipeline.createImageLoader(GRADIENT_URL, {
        fit: 'contain',
        resize: { width: 120, height: 80 },
      });
      expect(sizeOf(await loader.loadImage())).toEqual({
        width: 80,
        height: 80,
      });
    });

    it("the resize's own fit wins over the top-level one", async () => {
      const loader = NitroImagePipeline.createImageLoader(GRADIENT_URL, {
        fit: 'cover',
        resize: { width: 120, height: 80, fit: 'contain' },
      });
      expect(sizeOf(await loader.loadImage())).toEqual({
        width: 80,
        height: 80,
      });
    });

    it('applies allowUpscale', async () => {
      const loader = NitroImagePipeline.createImageLoader(GRADIENT_URL, {
        fit: 'contain',
        allowUpscale: false,
        resize: { width: 300, height: 400 },
      });
      expect(sizeOf(await loader.loadImage())).toEqual({
        width: 200,
        height: 200,
      });
    });
  });

  describe('PipelineImage', () => {
    it('derives fit from resizeMode', async () => {
      let loaded: Image | undefined;
      await render(
        <PipelineImage
          url={GRADIENT_URL}
          style={styles.fixed}
          resizeMode="contain"
          onLoad={(img) => {
            loaded = img;
          }}
        />,
      );
      await waitFor(() => expect(loaded).toBeDefined());
      // A square source fitted into 100×50 pt is 50×50 pt: no crop, no padding.
      expect(loaded && sizeOf(loaded)).toEqual({
        width: px(50),
        height: px(50),
      });
    });

    it('an explicit fit overrides resizeMode', async () => {
      let loaded: Image | undefined;
      await render(
        <PipelineImage
          url={GRADIENT_URL}
          style={styles.fixed}
          resizeMode="contain"
          fit="cover"
          onLoad={(img) => {
            loaded = img;
          }}
        />,
      );
      await waitFor(() => expect(loaded).toBeDefined());
      expect(loaded && sizeOf(loaded)).toEqual({
        width: px(100),
        height: px(50),
      });
    });

    it('center decodes at most the box, without scaling', async () => {
      let loaded: Image | undefined;
      await render(
        <PipelineImage
          url={GRADIENT_URL}
          style={styles.fixed}
          resizeMode="center"
          onLoad={(img) => {
            loaded = img;
          }}
        />,
      );
      await waitFor(() => expect(loaded).toBeDefined());
      expect(loaded && sizeOf(loaded)).toEqual(
        fitGeometry(200, 200, px(100), px(50), 'center'),
      );
    });

    it('allowUpscale={false} keeps a small source at its size', async () => {
      let loaded: Image | undefined;
      await render(
        <PipelineImage
          url={GRADIENT_URL}
          style={styles.fixed}
          resizeMode="contain"
          allowUpscale={false}
          onLoad={(img) => {
            loaded = img;
          }}
        />,
      );
      await waitFor(() => expect(loaded).toBeDefined());
      expect(loaded && sizeOf(loaded)).toEqual(
        fitGeometry(200, 200, px(100), px(50), 'contain', false),
      );
    });
  });

  describe('NativePipelineImage', () => {
    // `onLoad` is not one-shot (a view can report the same image twice), so
    // each test records the latest size and waits for it.
    function probe() {
      let size: Size | undefined;
      return {
        onLoad: (width: number, height: number) => {
          size = { width, height };
        },
        size: () => size,
      };
    }

    it('derives fit from resizeMode', async () => {
      const reported = probe();
      await render(
        <NativePipelineImage
          url={GRADIENT_URL}
          style={styles.fixed}
          resizeMode="contain"
          // An explicit box keeps the expectation independent of the screen scale.
          resize={{ width: 120, height: 80 }}
          onLoad={reported.onLoad}
        />,
      );
      await waitFor(() => expect(reported.size()).toBeDefined());
      expect(reported.size()).toEqual({ width: 80, height: 80 });
    });

    it('an explicit fit overrides resizeMode', async () => {
      const reported = probe();
      await render(
        <NativePipelineImage
          url={GRADIENT_URL}
          style={styles.fixed}
          resizeMode="contain"
          fit="stretch"
          resize={{ width: 120, height: 80 }}
          onLoad={reported.onLoad}
        />,
      );
      await waitFor(() => expect(reported.size()).toBeDefined());
      expect(reported.size()).toEqual({ width: 120, height: 80 });
    });

    it('center with allowUpscale is a bounded, unscaled decode', async () => {
      const reported = probe();
      await render(
        <NativePipelineImage
          url={GRADIENT_URL}
          style={styles.fixed}
          resizeMode="center"
          resize={{ width: 300, height: 120 }}
          onLoad={reported.onLoad}
        />,
      );
      await waitFor(() => expect(reported.size()).toBeDefined());
      expect(reported.size()).toEqual({ width: 200, height: 120 });
    });

    it('applies allowUpscale to the measured size', async () => {
      const reported = probe();
      await render(
        <NativePipelineImage
          url={GRADIENT_URL}
          style={styles.fixed}
          resizeMode="contain"
          allowUpscale={false}
          onLoad={reported.onLoad}
        />,
      );
      await waitFor(() => expect(reported.size()).toBeDefined());
      expect(reported.size()).toEqual(
        fitGeometry(200, 200, px(100), px(50), 'contain', false),
      );
    });
  });
});
