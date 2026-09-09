import { type ComponentRef, forwardRef } from 'react';
import type { HostComponent } from 'react-native';
import { NativeNitroImage } from 'react-native-nitro-image';

import { cornerRadiusForStyle } from './resizeForStyle';
import { type ImageSource, recyclingKeyFor } from './resolveImageSource';
import type {
  CacheOption,
  CornerRadii,
  ResizeFit,
  ResizeOptions,
} from './specs/nitro-image-toolkit.nitro';
import { usePipelineImageLoader } from './usePipelineImageLoader';

type ReactProps<T> = T extends HostComponent<infer P> ? P : never;
type NativeImageProps = ReactProps<typeof NativeNitroImage>;

/**
 * The instance `<NativePipelineImage>` exposes through its `ref` — the
 * underlying `NativeNitroImage` host view, with the usual native-view
 * methods (`measure`, …).
 */
export type NativePipelineImageRef = ComponentRef<typeof NativeNitroImage>;

export interface NativePipelineImageProps extends Omit<
  NativeImageProps,
  'image'
> {
  /**
   * The image to load through the pipeline: a URL string (`https://`,
   * `file://`, an absolute path) or a `require()`d asset — see
   * {@linkcode ImageSource}.
   */
  url: ImageSource;
  /**
   * Gaussian blur sigma in **points** (density-independent), like
   * `PipelineImage`. Applied natively with the screen scale.
   * @default 0
   */
  blur?: number;
  /**
   * Corner radius in **points** — a single number or per-corner radii.
   * When omitted, it's derived from `style`'s `borderRadius`-family
   * properties instead — set this prop to override that.
   * @default undefined (derived from `style`, or square corners if unset there)
   */
  cornerRadius?: number | CornerRadii;
  cache?: CacheOption;
  /**
   * Target bitmap size in **pixels**, overriding the size the native side
   * measures from the view. Rarely needed.
   * @default undefined (measure the view natively)
   */
  resize?: ResizeOptions;
  /**
   * How the source is fitted into the measured view size when the bitmap is
   * produced — see {@linkcode ResizeFit}. When omitted it follows
   * `resizeMode`, like `PipelineImage`. Set this to decouple the two.
   * @default undefined (derived from `resizeMode`, or `'cover'` if unset)
   */
  fit?: ResizeFit;
  /**
   * `false` never enlarges a source smaller than the view — see
   * {@linkcode ResizeOptions.allowUpscale}.
   * @default true
   */
  allowUpscale?: boolean;
  /**
   * Called when the view has displayed the image, with the size of the bitmap
   * it displays in **pixels**.
   *
   * Unlike `PipelineImage`'s `onLoad` this doesn't hand you the `Image` — the
   * bitmap stays native, which is the point of this component — and it means
   * "the view is now showing this image" rather than firing exactly once: a
   * recycled cell re-attaching calls it again, and a single view may call it
   * more than once for the same image. Make it idempotent.
   *
   * Setting it means there is per-image JS work again; leave it unset and the
   * component stays free of JS round trips.
   */
  onLoad?: (width: number, height: number) => void;
  /**
   * Called when loading fails, with the underlying error's message. A load
   * cancelled by the view detaching is not a failure and doesn't call this.
   *
   * Without it, failures on this component are silent — there is no `Image`
   * and no promise to surface them.
   */
  onError?: (message: string) => void;
}

/**
 * The fully native-driven variant of `PipelineImage`: after the first render
 * there is **zero JS work per image**. The native view starts the request
 * when it attaches to the window — at its own laid-out size, so nothing
 * waits for an `onLayout` round trip — and cancels it (releasing the bitmap)
 * when it detaches, which makes off-screen list cells free. Loads go through
 * the same pipeline and caches as `useImage`/`preLoadImage`.
 *
 * Compared to `PipelineImage`:
 * - `onLoad` reports the bitmap's pixel size rather than the `Image` itself,
 *   which never crosses into JS, and can fire more than once for a view. Use
 *   `PipelineImage` (or `useImage`) when you need the `Image`.
 * - The bitmap is loaded once at the size the view first has; if the view is
 *   resized later, the bitmap scales with it instead of reloading.
 * @example
 * ```tsx
 * <NativePipelineImage
 *   url="https://example.com/photo.jpg"
 *   style={{ width: 300, height: 200, borderRadius: 24 }}
 *   blur={4}
 * />
 * ```
 */
export const NativePipelineImage = forwardRef<
  NativePipelineImageRef,
  NativePipelineImageProps
>(function NativePipelineImage(
  {
    url,
    blur,
    cornerRadius,
    cache,
    resize,
    fit,
    allowUpscale,
    onLoad,
    onError,
    style,
    resizeMode,
    ...viewProps
  },
  ref,
) {
  // Same precedence as PipelineImage: an explicit prop wins over style.
  const effectiveCornerRadius = cornerRadius ?? cornerRadiusForStyle(style);
  // Inline arrows are fine here — the hook keeps the callbacks in a ref, so a
  // new identity doesn't recreate the loader (which would reload the image).
  const loader = usePipelineImageLoader(url, {
    blur,
    cornerRadius: effectiveCornerRadius,
    cache,
    resize,
    // Same four values as the view's resizeMode; an explicit `fit` decouples
    // them.
    fit: fit ?? resizeMode,
    allowUpscale,
    onLoad,
    onError,
  });

  return (
    <NativeNitroImage
      // Before the spread so a caller-provided recyclingKey wins.
      recyclingKey={recyclingKeyFor(url)}
      {...viewProps}
      ref={ref}
      style={style}
      resizeMode={resizeMode}
      image={loader}
    />
  );
});

// Reanimated and DevTools read the display name; the forwardRef wrapper
// would otherwise report as anonymous.
NativePipelineImage.displayName = 'NativePipelineImage';
