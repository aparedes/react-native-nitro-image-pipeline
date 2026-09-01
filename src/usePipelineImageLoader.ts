import { useMemo } from 'react';
import type { ImageLoader } from 'react-native-nitro-image';

import { NitroImagePipeline } from './NitroImagePipeline';
import type {
  CornerRadii,
  ViewOptions,
} from './specs/nitro-image-toolkit.nitro';

/**
 * Creates (and memoizes) an {@linkcode ImageLoader} for `url` to pass to
 * `<NativeNitroImage image={...} />`. The view drives it entirely natively:
 * the request starts when the view attaches — at the view's laid-out size,
 * with no JS round trips — and is cancelled when it detaches. See
 * {@linkcode NitroImagePipeline.createImageLoader}.
 *
 * `blur`/`cornerRadius` are in **points** (unlike `useImage`, where they are
 * bitmap pixels); the screen scale is applied natively. Inline object
 * literals are fine — options are compared by value, not identity.
 */
export function usePipelineImageLoader(
  url: string,
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

  return useMemo(() => {
    const cornerRadiusOption: number | CornerRadii | undefined = isUniformRadius
      ? uniformRadius
      : hasCornerObject
        ? { topLeft, topRight, bottomLeft, bottomRight }
        : undefined;
    const stableOptions: ViewOptions = {
      blur,
      cache,
      cornerRadius: cornerRadiusOption,
      resize:
        resizeWidth !== undefined && resizeHeight !== undefined
          ? { width: resizeWidth, height: resizeHeight }
          : undefined,
    };
    const loader = NitroImagePipeline.createImageLoader(url, stableOptions);
    // `NativeNitroImage` needs a way to tell two loader instances apart when
    // diffing its `image` prop; tag the loader with what it will load (the
    // same convention react-native-nitro-image's own loaders use).
    Object.defineProperty(loader, '__source', {
      enumerable: true,
      configurable: true,
      value: { url, options: stableOptions },
    });
    return loader;
  }, [
    url,
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
  ]);
}
