import { useEffect, useRef, useState } from 'react';
import type { Image } from 'react-native-nitro-image';
import { NitroModules } from 'react-native-nitro-modules';

import type {
  CacheOption,
  NitroImagePipeline as NitroImagePipelineSpec,
  Options,
} from './specs/nitro-image-toolkit.nitro';

export type { CacheOption, Options };

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
  cornerRadius?: number;
  cache?: CacheOption;
}): Result {
  const [image, setImage] = useState<Result>({
    image: undefined,
    error: undefined,
  });
  const loadedUrlRef = useRef(url);

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
          cornerRadius,
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
  }, [url, blur, cornerRadius, cache]);

  return image;
}
