import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { ImageLoader } from 'react-native-nitro-image';

import { NitroImagePipeline } from './NitroImagePipeline';
import {
  type ImageSource,
  resolveImageUrlOrFallback,
} from './resolveImageSource';
import type {
  CornerRadii,
  ViewOptions,
} from './specs/nitro-image-toolkit.nitro';

/**
 * Creates (and memoizes) an {@linkcode ImageLoader} for `source` — a URL
 * string or a `require()`d asset, see {@linkcode ImageSource} — to pass to
 * `<NativeNitroImage image={...} />`. The view drives it entirely natively:
 * the request starts when the view attaches — at the view's laid-out size,
 * with no JS round trips — and is cancelled when it detaches. See
 * {@linkcode NitroImagePipeline.createImageLoader}.
 *
 * `blur`/`cornerRadius` are in **points** (unlike `useImage`, where they are
 * bitmap pixels); the screen scale is applied natively. Inline object
 * literals are fine — options are compared by value, not identity, and the
 * `onLoad`/`onError` callbacks are read through a ref, so inline arrows don't
 * recreate the loader either.
 */
export function usePipelineImageLoader(
  source: ImageSource,
  options?: ViewOptions,
): ImageLoader {
  // Split the options into primitives (like useImage does) so an inline
  // literal — a new identity every render — doesn't recreate the loader;
  // recreating it would re-trigger the native load.
  const blur = options?.blur;
  const cache = options?.cache;
  const cornerRadius = options?.cornerRadius;
  const isUniformRadius = typeof cornerRadius === 'number';
  const uniformRadius = isUniformRadius ? cornerRadius : 0;
  const hasCornerObject = !isUniformRadius && cornerRadius !== undefined;
  const {
    topLeft = 0,
    topRight = 0,
    bottomLeft = 0,
    bottomRight = 0,
  } = isUniformRadius || cornerRadius === undefined ? {} : cornerRadius;
  const resizeWidth = options?.resize?.width;
  const resizeHeight = options?.resize?.height;
  const onLoad = options?.onLoad;
  const onError = options?.onError;
  // Only *whether* a callback is set can change the loader: the native side
  // gets the stable wrappers below, which read the latest callbacks from a ref
  // (like PipelineImage does). So an inline arrow — a new identity every
  // render — doesn't recreate the loader and re-trigger the native load.
  const hasOnLoad = onLoad !== undefined;
  const hasOnError = onError !== undefined;
  const callbacks = useRef({ onLoad, onError });
  useEffect(() => {
    callbacks.current = { onLoad, onError };
  });
  const notifyLoad = useCallback((width: number, height: number) => {
    callbacks.current.onLoad?.(width, height);
  }, []);
  const notifyError = useCallback((message: string) => {
    callbacks.current.onError?.(message);
  }, []);

  return useMemo(() => {
    // Runs during render, so an unregistered `require()` id must not throw:
    // it becomes a URL the native loader fails on at load time instead.
    const url = resolveImageUrlOrFallback(source);
    const cornerRadiusOption: number | CornerRadii | undefined = isUniformRadius
      ? uniformRadius
      : hasCornerObject
        ? { topLeft, topRight, bottomLeft, bottomRight }
        : undefined;
    // What is loaded — the callbacks are deliberately not part of it, so two
    // loaders that differ only in them are the same image.
    const stableOptions: ViewOptions = {
      blur,
      cache,
      cornerRadius: cornerRadiusOption,
      resize:
        resizeWidth !== undefined && resizeHeight !== undefined
          ? { width: resizeWidth, height: resizeHeight }
          : undefined,
    };
    // `notifyLoad`/`notifyError` read the ref above, but only when the native
    // side calls them — the rule can't see that they aren't called here.
    // oxlint-disable-next-line react/refs
    const loader = NitroImagePipeline.createImageLoader(url, {
      ...stableOptions,
      // Passed only when the caller wants them: without a callback nothing
      // ever crosses into JS, which is the point of the native path.
      onLoad: hasOnLoad ? notifyLoad : undefined,
      onError: hasOnError ? notifyError : undefined,
    });
    // `NativeNitroImage` needs a way to tell two loader instances apart when
    // diffing its `image` prop; tag the loader with what it will load (the
    // same convention react-native-nitro-image's own loaders use). Toggling a
    // callback on or off makes a different loader, so the tag has to say so —
    // otherwise the view keeps the old one installed. Their identities stay
    // out of it: those don't change what is loaded, or which loader this is.
    Object.defineProperty(loader, '__source', {
      enumerable: true,
      configurable: true,
      value: {
        url,
        options: stableOptions,
        callbacks: { onLoad: hasOnLoad, onError: hasOnError },
      },
    });
    return loader;
  }, [
    source,
    blur,
    cache,
    isUniformRadius,
    uniformRadius,
    hasCornerObject,
    topLeft,
    topRight,
    bottomLeft,
    bottomRight,
    resizeWidth,
    resizeHeight,
    hasOnLoad,
    hasOnError,
    notifyLoad,
    notifyError,
  ]);
}
