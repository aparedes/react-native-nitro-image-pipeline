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
  // component) — only its size, through `onLoad` — so the tests without a
  // callback are smoke tests: mounting must kick off the native load path
  // without throwing or crashing.
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

  it('reports the displayed bitmap size to onLoad, in pixels', async () => {
    let size: { width: number; height: number } | undefined;
    await render(
      // An explicit resize keeps the expected size independent of the
      // device's screen scale.
      <NativePipelineImage
        url={VALID_URL}
        style={styles.fixed}
        resize={{ width: 120, height: 80 }}
        onLoad={(width, height) => {
          size = { width, height };
        }}
      />,
    );
    await waitFor(() => expect(size).toBeDefined());
    expect(size?.width).toBe(120);
    expect(size?.height).toBe(80);
  });

  it('reports a failing load to onError', async () => {
    let message: string | undefined;
    await render(
      <NativePipelineImage
        url={INVALID_URL}
        style={styles.fixed}
        onError={(error) => {
          message = error;
        }}
      />,
    );
    // A failed DNS lookup for a `.invalid` host can take a cold CI simulator
    // longer than waitFor's 1 s default to report.
    await waitFor(() => expect(message).toBeDefined(), { timeout: 10000 });
  });

  it('picks up a callback added after the first render', async () => {
    let message: string | undefined;
    let enable: (() => void) | undefined;
    function Probe() {
      const [enabled, setEnabled] = useState(false);
      useEffect(() => {
        enable = () => setEnabled(true);
      });
      return (
        <NativePipelineImage
          url={INVALID_URL}
          style={styles.fixed}
          onError={
            enabled
              ? (error) => {
                  message = error;
                }
              : undefined
          }
        />
      );
    }
    // Toggling a callback on makes a different loader; the view has to notice
    // and install it, or the callback would never be called.
    await render(<Probe />);
    enable?.();
    // A failed DNS lookup for a `.invalid` host can take a cold CI simulator
    // longer than waitFor's 1 s default to report.
    await waitFor(() => expect(message).toBeDefined(), { timeout: 10000 });
  });

  it('does not reload when only the callbacks change identity', async () => {
    let loads = 0;
    let forceRender: (() => void) | undefined;
    function Probe() {
      const [, setTick] = useState(0);
      useEffect(() => {
        forceRender = () => setTick((tick) => tick + 1);
      });
      return (
        // Inline arrows on purpose: a new identity every render must not
        // recreate the loader, which would load the image again.
        <NativePipelineImage
          url={VALID_URL}
          style={styles.fixed}
          resize={{ width: 120, height: 80 }}
          onLoad={() => {
            loads += 1;
          }}
        />
      );
    }
    await render(<Probe />);
    await waitFor(() => expect(loads).toBeGreaterThanOrEqual(1));
    // A single mount can report more than once — the view requests the image
    // both when its `image` prop is set and when it becomes visible — so let
    // the mount settle and compare against whatever it settled on.
    await new Promise((resolve) => setTimeout(resolve, 500));
    const settled = loads;
    forceRender?.();
    forceRender?.();
    // A recreated loader would re-request (and, on a memory-cache hit, report)
    // shortly after; give it time to show up rather than asserting instantly.
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(loads).toBe(settled);
  });
});
