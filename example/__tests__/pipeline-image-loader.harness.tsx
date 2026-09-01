import { useEffect, useState } from 'react';
import { StyleSheet } from 'react-native';
import { describe, expect, it, render, waitFor } from 'react-native-harness';
import type { ImageLoader } from 'react-native-nitro-image';
import {
  NativePipelineImage,
  NitroImagePipeline,
  usePipelineImageLoader,
} from 'react-native-nitro-image-pipeline';

import { GRADIENT_URL as VALID_URL, INVALID_URL } from './fixture-urls';

const styles = StyleSheet.create({
  fixed: { width: 100, height: 50 },
  rounded: { width: 100, height: 50, borderRadius: 12 },
});

describe('createImageLoader', () => {
  it('loads at the explicit resize size via loadImage()', async () => {
    const loader = NitroImagePipeline.createImageLoader(VALID_URL, {
      resize: { width: 120, height: 80 },
    });
    const image = await loader.loadImage();
    expect(image.width).toBe(120);
    expect(image.height).toBe(80);
  });

  it('applies point-based blur and cornerRadius', async () => {
    const loader = NitroImagePipeline.createImageLoader(VALID_URL, {
      blur: 2,
      cornerRadius: 8,
      resize: { width: 120, height: 80 },
    });
    const image = await loader.loadImage();
    expect(image.width).toBe(120);
    expect(image.height).toBe(80);
  });

  it('rejects at load time for an unreachable URL', async () => {
    const loader = NitroImagePipeline.createImageLoader(INVALID_URL);
    await expect(loader.loadImage()).rejects.toThrow();
  });
});

describe('usePipelineImageLoader', () => {
  it('returns a stable loader across re-renders with inline options', async () => {
    const loaders: ImageLoader[] = [];
    let forceRender: (() => void) | undefined;
    function Probe() {
      const [, setTick] = useState(0);
      useEffect(() => {
        forceRender = () => setTick((tick) => tick + 1);
      });
      // Inline literal on purpose: a new identity every render must not
      // recreate the loader.
      const loader = usePipelineImageLoader(VALID_URL, {
        blur: 2,
        cornerRadius: { topLeft: 4 },
      });
      loaders.push(loader);
      return null;
    }
    await render(<Probe />);
    await waitFor(() => expect(loaders.length).toBeGreaterThanOrEqual(1));
    forceRender?.();
    await waitFor(() => expect(loaders.length).toBeGreaterThanOrEqual(2));
    // Every render must have seen the same instance.
    expect(new Set(loaders).size).toBe(1);
  });
});

describe('NativePipelineImage', () => {
  // The loaded Image never crosses into JS (that's the point of the
  // component), so these are on-device smoke tests: mounting must kick off
  // the native load path without throwing or crashing.
  it('renders with a fixed-size style', async () => {
    await render(<NativePipelineImage url={VALID_URL} style={styles.fixed} />);
  });

  it('renders with style-derived rounding and blur', async () => {
    await render(
      <NativePipelineImage url={VALID_URL} blur={2} style={styles.rounded} />,
    );
  });

  it('unmounts cleanly while a load may be in flight', async () => {
    const result = await render(
      <NativePipelineImage url={VALID_URL} style={styles.fixed} />,
    );
    result.unmount();
  });
});
