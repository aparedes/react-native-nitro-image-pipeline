import { useEffect, useState } from 'react';
import type { Image } from 'react-native-nitro-image';
import { NitroModules } from 'react-native-nitro-modules';

import type { NitroImagePipeline as NitroImagePipelineSpec } from './specs/nitro-image-toolkit.nitro';

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
  blur?: number;
  cornerRadius?: number;
  cache?: 'memory' | 'disk' | 'none';
}): Result {
  const [image, setImage] = useState<Result>({
    image: undefined,
    error: undefined,
  });

  useEffect(() => {
    let cancelled = false;
    setImage({ image: undefined, error: undefined });

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
