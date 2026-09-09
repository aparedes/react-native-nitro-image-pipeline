import { type RefObject, useLayoutEffect, useMemo, useRef } from 'react';
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

// Identifies a loader in the callbacks below without them capturing it. A
// callback the native loader owns that captured the loader back would be a
// cycle across the language boundary — neither side collectable, and the JS
// runtime left to take it apart at teardown.
let nextLoaderToken = 0;

type Callbacks = Pick<ViewOptions, 'onLoad' | 'onError'>;

/**
 * The callbacks handed to a native loader. Built out here, where the scope
 * holds nothing but the token and the two refs, so the loader can't end up
 * captured by a callback it owns.
 */
function makeReporters(
  token: number,
  activeToken: RefObject<number>,
  callbacks: RefObject<Callbacks>,
): Required<Callbacks> {
  return {
    onLoad: (width, height) => {
      if (activeToken.current === token) {
        callbacks.current.onLoad?.(width, height);
      }
    },
    onError: (message) => {
      if (activeToken.current === token) {
        callbacks.current.onError?.(message);
      }
    },
  };
}

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
  // Only *whether* a callback is set can change the loader: what the native
  // side gets is a wrapper that reads the latest callbacks from a ref (like
  // PipelineImage does). So an inline arrow — a new identity every render —
  // doesn't recreate the loader and re-trigger the native load.
  const hasOnLoad = onLoad !== undefined;
  const hasOnError = onError !== undefined;
  const callbacks = useRef({ onLoad, onError });
  // A layout effect, not a passive one: passive effects are flushed in a later
  // task, so a load reported between the commit and that flush would read the
  // previous render's callbacks — a callback added alongside a new loader
  // could miss its only event. This runs in the same task as the commit, and
  // the view can't reach the loader before the commit installs it, so the ref
  // is always current by the time native calls back. (Assigning it during
  // render instead would mutate on renders React throws away.)
  useLayoutEffect(() => {
    callbacks.current = { onLoad, onError };
  });
  // The token of the loader the view is currently on. Swapping loaders (a
  // changed url or options) never drops the old one — the view just stops
  // referring to it — so a load it already had in flight can still report.
  // Without this check the wrappers, which read the latest callbacks, would
  // hand the previous image's size to the current `onLoad`.
  const activeToken = useRef(-1);

  const memoized = useMemo(() => {
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
    const token = nextLoaderToken++;
    // The reporters read the refs, but only when the native side calls them —
    // the rule can't see that they aren't called here.
    // oxlint-disable-next-line react/refs
    const reporters = makeReporters(token, activeToken, callbacks);
    const loader = NitroImagePipeline.createImageLoader(url, {
      ...stableOptions,
      // Passed only when the caller wants them: without a callback nothing
      // ever crosses into JS, which is the point of the native path.
      onLoad: hasOnLoad ? reporters.onLoad : undefined,
      onError: hasOnError ? reporters.onError : undefined,
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
    return { loader, token };
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
    // Stable ref objects; listed to satisfy the exhaustive-deps rules.
    activeToken,
    callbacks,
  ]);

  // Same reasoning as the callbacks ref: a layout effect is current before the
  // view — which the commit has only just handed this loader — can report.
  useLayoutEffect(() => {
    activeToken.current = memoized.token;
  }, [memoized, activeToken]);

  return memoized.loader;
}
