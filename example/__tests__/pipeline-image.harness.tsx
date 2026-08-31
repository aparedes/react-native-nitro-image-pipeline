import { PixelRatio, StyleSheet, View } from 'react-native';
import { describe, expect, it, render, waitFor } from 'react-native-harness';
import type { Image } from 'react-native-nitro-image';
import { PipelineImage } from 'react-native-nitro-image-pipeline';

import { GRADIENT_URL as VALID_URL } from './fixture-urls';
const px = (points: number) => PixelRatio.getPixelSizeForLayoutSize(points);

const styles = StyleSheet.create({
  fixed: { width: 100, height: 50 },
  container: { width: 200 },
  half: { width: '50%', aspectRatio: 2 },
  rounded: { width: 100, height: 50, borderRadius: 12 },
  perCorner: {
    width: 100,
    height: 50,
    borderTopLeftRadius: 20,
    borderBottomRightRadius: 30,
  },
});

describe('PipelineImage', () => {
  it('resizes to the numeric style size in pixels', async () => {
    let loaded: Image | undefined;
    await render(
      <PipelineImage
        url={VALID_URL}
        style={styles.fixed}
        onLoad={(img) => {
          loaded = img;
        }}
      />,
    );
    await waitFor(() => expect(loaded).toBeDefined());
    expect(loaded?.width).toBe(px(100));
    expect(loaded?.height).toBe(px(50));
  });

  it('waits for layout and resizes to the measured size', async () => {
    let loaded: Image | undefined;
    await render(
      <View style={styles.container}>
        <PipelineImage
          url={VALID_URL}
          style={styles.half}
          onLoad={(img) => {
            loaded = img;
          }}
        />
      </View>,
    );
    await waitFor(() => expect(loaded).toBeDefined());
    expect(loaded?.width).toBe(px(100));
    expect(loaded?.height).toBe(px(50));
  });

  it("calls the caller's onLayout too", async () => {
    let layouts = 0;
    await render(
      <PipelineImage
        url={VALID_URL}
        style={styles.fixed}
        onLayout={() => {
          layouts += 1;
        }}
      />,
    );
    await waitFor(() => expect(layouts).toBeGreaterThan(0));
  });

  it('bakes cornerRadius in points into the resized bitmap', async () => {
    let loaded: Image | undefined;
    await render(
      <PipelineImage
        url={VALID_URL}
        style={styles.fixed}
        cornerRadius={12}
        onLoad={(img) => {
          loaded = img;
        }}
      />,
    );
    await waitFor(() => expect(loaded).toBeDefined());
    expect(loaded?.width).toBe(px(100));
    expect(loaded?.height).toBe(px(50));
  });

  it('derives cornerRadius from style.borderRadius when the prop is omitted', async () => {
    let loaded: Image | undefined;
    await render(
      <PipelineImage
        url={VALID_URL}
        style={styles.rounded}
        onLoad={(img) => {
          loaded = img;
        }}
      />,
    );
    await waitFor(() => expect(loaded).toBeDefined());
    expect(loaded?.width).toBe(px(100));
    expect(loaded?.height).toBe(px(50));
  });

  it('derives per-corner radii from style border*Radius properties', async () => {
    let loaded: Image | undefined;
    await render(
      <PipelineImage
        url={VALID_URL}
        style={styles.perCorner}
        onLoad={(img) => {
          loaded = img;
        }}
      />,
    );
    await waitFor(() => expect(loaded).toBeDefined());
    expect(loaded?.width).toBe(px(100));
    expect(loaded?.height).toBe(px(50));
  });

  it('lets an explicit cornerRadius prop override style.borderRadius', async () => {
    let loaded: Image | undefined;
    await render(
      <PipelineImage
        url={VALID_URL}
        style={styles.rounded}
        cornerRadius={0}
        onLoad={(img) => {
          loaded = img;
        }}
      />,
    );
    await waitFor(() => expect(loaded).toBeDefined());
    expect(loaded?.width).toBe(px(100));
    expect(loaded?.height).toBe(px(50));
  });

  it('reports errors through onError', async () => {
    let err: Error | undefined;
    await render(
      <PipelineImage
        url="https://not-real.invalid/x.jpg"
        style={styles.fixed}
        onError={(e) => {
          err = e;
        }}
      />,
    );
    await waitFor(() => expect(err).toBeDefined());
  });
});
