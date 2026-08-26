import { PixelRatio, StyleSheet } from 'react-native';
import { describe, expect, it } from 'react-native-harness';
import {
  cornerRadiusForStyle,
  resizeForLayout,
  resizeForStyle,
} from 'react-native-nitro-image-pipeline';

const px = (points: number) => PixelRatio.getPixelSizeForLayoutSize(points);

const styles = StyleSheet.create({
  base: { width: 300, height: 200 },
  override: { width: 150 },
  percentWidth: { width: '50%', height: 100 },
  widthOnly: { width: 300 },
  uniformRadius: { borderRadius: 12 },
  perCornerRadius: { borderTopLeftRadius: 20, borderBottomRightRadius: 30 },
  mixedRadius: { borderRadius: 8, borderTopLeftRadius: 20 },
  percentRadius: { borderRadius: '50%' },
});

describe('resizeForStyle', () => {
  it('converts a numeric style size to pixels', () => {
    expect(resizeForStyle(styles.base)).toEqual({
      width: px(300),
      height: px(200),
    });
  });

  it('lets a later style in an array override an earlier one', () => {
    expect(resizeForStyle([styles.base, styles.override])).toEqual({
      width: px(150),
      height: px(200),
    });
  });

  it('returns undefined for a percentage width', () => {
    expect(resizeForStyle(styles.percentWidth)).toBeUndefined();
  });

  it('returns undefined when height is missing', () => {
    expect(resizeForStyle(styles.widthOnly)).toBeUndefined();
  });

  it('returns undefined for an undefined style', () => {
    expect(resizeForStyle(undefined)).toBeUndefined();
  });

  it('returns undefined for a zero-sized style', () => {
    expect(resizeForStyle({ width: 0, height: 10 })).toBeUndefined();
  });
});

describe('resizeForLayout', () => {
  it('rounds fractional layout sizes to whole pixels', () => {
    const result = resizeForLayout(33.33, 10.5);
    expect(Number.isInteger(result?.width)).toBe(true);
    expect(Number.isInteger(result?.height)).toBe(true);
  });
});

describe('cornerRadiusForStyle', () => {
  it('returns a uniform number for borderRadius alone', () => {
    expect(cornerRadiusForStyle(styles.uniformRadius)).toBe(12);
  });

  it('returns per-corner radii, leaving unset corners square', () => {
    expect(cornerRadiusForStyle(styles.perCornerRadius)).toEqual({
      topLeft: 20,
      topRight: undefined,
      bottomLeft: undefined,
      bottomRight: 30,
    });
  });

  it('lets a per-corner property override borderRadius for that corner', () => {
    expect(cornerRadiusForStyle(styles.mixedRadius)).toEqual({
      topLeft: 20,
      topRight: 8,
      bottomLeft: 8,
      bottomRight: 8,
    });
  });

  it('returns undefined when no radius is set', () => {
    expect(cornerRadiusForStyle(styles.base)).toBeUndefined();
  });

  it('ignores a percentage borderRadius', () => {
    expect(cornerRadiusForStyle(styles.percentRadius)).toBeUndefined();
  });
});
