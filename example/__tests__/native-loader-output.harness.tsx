import { StyleSheet } from 'react-native';
import { beforeAll, describe, expect, it, render } from 'react-native-harness';
import {
  NativePipelineImage,
  NitroImagePipeline,
} from 'react-native-nitro-image-pipeline';

import { CHECKER_URL, GRADIENT_URL } from './fixture-urls';

const styles = StyleSheet.create({
  cell: { width: 100, height: 50, borderRadius: 12 },
});

describe('rounded thumbnails', () => {
  // The pipeline stores processed images encoded on disk, so a warm cache
  // would hand back an earlier build's output without running the processors.
  beforeAll(async () => {
    await NitroImagePipeline.clearCache();
  });

  // Android skips the explicit resize when rounded corners are requested
  // without blur (Coil's RoundedCornersTransformation scale-fills and crops
  // to the request size itself), so the output size must still be exact —
  // including the non-square crop of a square source and an upscale.
  for (const [width, height] of [
    [120, 80],
    [300, 100],
    [64, 64],
  ]) {
    it(`resize ${width}x${height} with rounded corners and no blur is exact`, async () => {
      const image = await NitroImagePipeline.loadImage(CHECKER_URL, {
        resize: { width, height },
        cornerRadius: 16,
      });
      expect(image.width).toBe(width);
      expect(image.height).toBe(height);
    });
  }

  it('per-corner radii with resize and no blur are exact', async () => {
    const image = await NitroImagePipeline.loadImage(GRADIENT_URL, {
      resize: { width: 150, height: 90 },
      cornerRadius: { topLeft: 10, bottomRight: 40 },
    });
    expect(image.width).toBe(150);
    expect(image.height).toBe(90);
  });

  it('via createImageLoader().loadImage() is exact', async () => {
    const loader = NitroImagePipeline.createImageLoader(CHECKER_URL, {
      resize: { width: 120, height: 80 },
      cornerRadius: 8,
    });
    const image = await loader.loadImage();
    expect(image.width).toBe(120);
    expect(image.height).toBe(80);
  });
});

describe('NativePipelineImage recycling', () => {
  it('re-mounts a cell whose image is already in the memory cache', async () => {
    const first = await render(
      <NativePipelineImage url={GRADIENT_URL} style={styles.cell} />,
    );
    // Let the native load finish so the second mount is a memory-cache hit.
    await new Promise((resolve) => setTimeout(resolve, 1500));
    first.unmount();
    const second = await render(
      <NativePipelineImage url={GRADIENT_URL} style={styles.cell} />,
    );
    await new Promise((resolve) => setTimeout(resolve, 300));
    second.unmount();
  });
});
