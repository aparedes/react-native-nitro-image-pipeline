import { useEffect, useRef, useState } from 'react';
import {
  type HostComponent,
  type LayoutChangeEvent,
  PixelRatio,
} from 'react-native';
import { type Image, NativeNitroImage } from 'react-native-nitro-image';

import {
  cornerRadiusForStyle,
  resizeForLayout,
  resizeForStyle,
} from './resizeForStyle';
import type {
  CacheOption,
  CornerRadii,
  ResizeOptions,
} from './specs/nitro-image-toolkit.nitro';
import { useImage } from './useImage';

type ReactProps<T> = T extends HostComponent<infer P> ? P : never;
type NativeImageProps = ReactProps<typeof NativeNitroImage>;

export interface PipelineImageProps extends Omit<NativeImageProps, 'image'> {
  /** URL of the image to load through the pipeline. */
  url: string;
  /**
   * Gaussian blur sigma in **points** (density-independent). Unlike
   * `useImage`/`loadImage`, where it is bitmap pixels, the component
   * multiplies it by `PixelRatio.get()` so the same value looks the same on
   * every device.
   * @default 0
   */
  blur?: number;
  /**
   * Corner radius in **points** — a single number or per-corner radii.
   * Converted to bitmap pixels with `PixelRatio.get()` and baked into the
   * bitmap at the display size.
   *
   * When omitted, it's derived from `style`'s `borderRadius` /
   * `borderTopLeftRadius` / `borderTopRightRadius` / `borderBottomLeftRadius`
   * / `borderBottomRightRadius` instead — set this prop to override that.
   * @default undefined (derived from `style`, or square corners if unset there)
   */
  cornerRadius?: number | CornerRadii;
  cache?: CacheOption;
  /** Called with the processed `Image` each time a new variant resolves. */
  onLoad?: (image: Image) => void;
  /** Called when loading fails. */
  onError?: (error: Error) => void;
}

function sameSize(a?: ResizeOptions, b?: ResizeOptions): boolean {
  return a?.width === b?.width && a?.height === b?.height;
}

function scaleRadius(
  cornerRadius: number | CornerRadii,
  scale: number,
): number | CornerRadii {
  if (typeof cornerRadius === 'number') {
    return cornerRadius * scale;
  }
  return {
    topLeft: (cornerRadius.topLeft ?? 0) * scale,
    topRight: (cornerRadius.topRight ?? 0) * scale,
    bottomLeft: (cornerRadius.bottomLeft ?? 0) * scale,
    bottomRight: (cornerRadius.bottomRight ?? 0) * scale,
  };
}

/**
 * A `NativeNitroImage` that loads `url` through the pipeline at exactly the
 * size it is displayed: the bitmap is resized to the view's size in points ×
 * `PixelRatio.get()`, so `blur` and `cornerRadius` (both in points here) apply
 * 1:1 to what is on screen and large sources are never decoded at full size.
 *
 * A numeric `width`/`height` in `style` starts loading immediately; otherwise
 * (`'50%'`, `flex`, `aspectRatio`, …) loading waits for the first `onLayout`.
 * If the layout size later changes, a new variant is loaded and swapped in
 * without flashing. Without an explicit `cornerRadius` prop, `style`'s
 * `borderRadius`-family properties are baked into the bitmap instead — no
 * separate view-layer rounding needed.
 * @example
 * ```tsx
 * <PipelineImage
 *   url="https://example.com/photo.jpg"
 *   style={{ width: 300, height: 200 }}
 *   cornerRadius={24}
 * />
 * ```
 */
export function PipelineImage({
  url,
  blur = 0,
  cornerRadius,
  cache,
  onLoad,
  onError,
  style,
  onLayout,
  ...viewProps
}: PipelineImageProps) {
  const scale = PixelRatio.get();
  const styleSize = resizeForStyle(style);
  const [layoutSize, setLayoutSize] = useState<ResizeOptions | undefined>(
    undefined,
  );
  // A numeric style is what the caller declared, so it wins and starts the
  // request a frame earlier; the measured layout is the fallback.
  const resize = styleSize ?? layoutSize;
  // Same precedence: an explicit prop wins over what style implies.
  const effectiveCornerRadius =
    cornerRadius ?? cornerRadiusForStyle(style) ?? 0;

  const { image, error } = useImage({
    url,
    blur: blur * scale,
    cornerRadius: scaleRadius(effectiveCornerRadius, scale),
    cache,
    resize,
    enabled: resize !== undefined,
  });

  // Latest callbacks in refs so inline arrow props don't re-fire the effects.
  const onLoadRef = useRef(onLoad);
  const onErrorRef = useRef(onError);
  useEffect(() => {
    onLoadRef.current = onLoad;
    onErrorRef.current = onError;
  });
  useEffect(() => {
    if (image) onLoadRef.current?.(image);
  }, [image]);
  useEffect(() => {
    if (error) onErrorRef.current?.(error);
  }, [error]);

  const handleLayout = (event: LayoutChangeEvent) => {
    onLayout?.(event);
    const { width, height } = event.nativeEvent.layout;
    const next = resizeForLayout(width, height);
    // Always record it (even when a numeric style is in charge) so a later
    // switch to a non-numeric style has a size to fall back on.
    setLayoutSize((prev) => (sameSize(prev, next) ? prev : next));
  };

  return (
    <NativeNitroImage
      {...viewProps}
      style={style}
      onLayout={handleLayout}
      image={image}
    />
  );
}
