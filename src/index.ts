import { useEffect, useRef, useState } from 'react';
import type { Image } from 'react-native-nitro-image';
import { NitroModules } from 'react-native-nitro-modules';

import type {
  CacheOption,
  CornerRadii,
  NitroImagePipeline as NitroImagePipelineSpec,
  Options,
} from './specs/nitro-image-toolkit.nitro';

export type { CacheOption, CornerRadii, Options };

export const NitroImagePipeline =
  NitroModules.createHybridObject<NitroImagePipelineSpec>('NitroImagePipeline');

type Result =
  // Loading State
  | {
      image: undefined;
      error: undefined;
    }
  // Loaded state
  | {
      image: Image;
      error: undefined;
    }
  // Error state
  | {
      image: undefined;
      error: Error;
    };

/**
 * A hook to asynchronously load an image from the
 * given {@linkcode AsyncImageSource} into memory.
 * @example
 * ```ts
 * const { image, error } = useImage({ filePath: '/tmp/image.jpg' })
 * ```
 */
export function useImage({
  url,
  blur = 0,
  cornerRadius = 0,
  cache,
}: {
  url: string;
  /**
   * Gaussian blur strength, as the standard deviation (sigma) of the blur in
   * source-image pixels. Matches across iOS and Android; roughly half of
   * React Native's `blurRadius`.
   */
  blur?: number;
  /**
   * Corner radius in points, baked into the loaded bitmap. Pass a single
   * number for uniform rounding, or per-corner radii (inline object literals
   * are fine — the hook compares the radii by value, not identity).
   */
  cornerRadius?: number | CornerRadii;
  cache?: CacheOption;
}): Result {
  const [image, setImage] = useState<Result>({
    image: undefined,
    error: undefined,
  });
  const loadedUrlRef = useRef(url);

  // Split the option into primitives so an inline `{ topLeft: 24, ... }`
  // literal (new identity every render) doesn't re-trigger the effect.
  const isUniformRadius = typeof cornerRadius === 'number';
  const uniformRadius = isUniformRadius ? cornerRadius : 0;
  const {
    topLeft = 0,
    topRight = 0,
    bottomLeft = 0,
    bottomRight = 0,
  } = isUniformRadius ? {} : cornerRadius;

  useEffect(() => {
    let cancelled = false;
    // Only reset to the loading state when the URL changes; for same-URL
    // param tweaks (blur/cornerRadius/cache) keep showing the current image
    // until the new variant resolves, to avoid flashing empty.
    if (loadedUrlRef.current !== url) {
      loadedUrlRef.current = url;
      setImage({ image: undefined, error: undefined });
    }

    (async () => {
      try {
        const result = await NitroImagePipeline.loadImage(url, {
          blur,
          cornerRadius: isUniformRadius
            ? uniformRadius
            : { topLeft, topRight, bottomLeft, bottomRight },
          cache,
        });

        if (!cancelled) {
          setImage({ image: result, error: undefined });
        }
      } catch (e) {
        const error = e instanceof Error ? e : new Error(`${e}`);
        if (!cancelled) {
          setImage({ image: undefined, error: error });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    url,
    blur,
    isUniformRadius,
    uniformRadius,
    topLeft,
    topRight,
    bottomLeft,
    bottomRight,
    cache,
  ]);

  return image;
}
