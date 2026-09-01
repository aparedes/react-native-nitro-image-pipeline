import { useMemo } from 'react';
import type { ImageLoader } from 'react-native-nitro-image';

import { NitroImagePipeline } from './NitroImagePipeline';
import type { ViewOptions } from './specs/nitro-image-toolkit.nitro';

/**
 * Creates (and memoizes) an {@linkcode ImageLoader} for `url` to pass to
 * `<NativeNitroImage image={...} />`. The view drives it entirely natively:
 * the request starts when the view attaches — at the view's laid-out size,
 * with no JS round trips — and is cancelled when it detaches. See
 * {@linkcode NitroImagePipeline.createImageLoader}.
 *
 * `options` are in **points** (unlike `useImage`, where they are bitmap
 * pixels); the screen scale is applied natively. Inline object literals are
 * fine — options are compared by value, not identity.
 */
export function usePipelineImageLoader(
  url: string,
  options?: ViewOptions,
): ImageLoader {
  // Serialize so an inline options literal (new identity every render)
  // doesn't recreate the loader — recreating it would re-trigger the load.
  const optionsKey =
    options === undefined ? undefined : JSON.stringify(options);
  return useMemo(() => {
    const parsedOptions: ViewOptions | undefined =
      optionsKey === undefined ? undefined : JSON.parse(optionsKey);
    const loader = NitroImagePipeline.createImageLoader(url, parsedOptions);
    // `NativeNitroImage` needs a way to tell two loader instances apart when
    // diffing its `image` prop; tag the loader with what it will load (the
    // same convention react-native-nitro-image's own loaders use).
    Object.defineProperty(loader, '__source', {
      enumerable: true,
      configurable: true,
      value: { url, options: parsedOptions },
    });
    return loader;
  }, [url, optionsKey]);
}
