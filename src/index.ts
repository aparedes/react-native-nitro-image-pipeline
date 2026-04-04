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
}: {
  url: string;
  blur?: number;
  cornerRadius?: number;
}): Result {
  const [image, setImage] = useState<Result>({
    image: undefined,
    error: undefined,
  });

  useEffect(() => {
    (async () => {
      try {
        const result = await NitroImagePipeline.loadImage(url, {
          blur,
          cornerRadius,
        });

        setImage({ image: result, error: undefined });
      } catch (e) {
        const error = e instanceof Error ? e : new Error(`${e}`);
        setImage({ image: undefined, error: error });
      }
    })();
  }, [url, blur]);

  return image;
}
