import { Image as RNImage } from 'react-native';

/**
 * What the pipeline can load: a URL string, or the id a `require()`d image
 * asset evaluates to.
 *
 * As a string, `url` is passed to the native loader as-is. Accepted forms:
 *
 * - `https://` / `http://` — fetched over the network and cached on disk.
 * - `file://` URLs and plain absolute paths (`/var/…/photo.jpg`) — read from
 *   the file system. The result is cached in memory only; there is nothing
 *   to gain from copying a local file into the disk cache.
 * - Android also accepts `content://` URIs and, from a release build's
 *   resources, a bare drawable name — which is what `require()` resolves to
 *   there. iOS resolves `require()` to a `file://` URL into the app bundle.
 *
 * A `require('./photo.png')` is resolved with `Image.resolveAssetSource`, so
 * it works the same in debug (streamed from Metro) and release (bundled).
 */
export type ImageSource = string | number;

/**
 * Turns an {@linkcode ImageSource} into the URL string the native pipeline
 * loads: strings pass through unchanged, a `require()`d asset is resolved via
 * `Image.resolveAssetSource` (the scale-matched variant, like `<Image>`).
 *
 * The components and hooks call this for you; use it when calling
 * `NitroImagePipeline.loadImage`/`preLoadImage` directly with a `require()`.
 * @throws If `source` is a number that is not a registered asset.
 * @example
 * ```ts
 * const image = await NitroImagePipeline.loadImage(
 *   resolveImageUrl(require('./photo.png')),
 *   { blur: 4 },
 * );
 * ```
 */
export function resolveImageUrl(source: ImageSource): string {
  if (typeof source === 'string') {
    return source;
  }
  const resolved = RNImage.resolveAssetSource(source);
  if (resolved == null) {
    throw new Error(`Not a registered image asset: require() id ${source}`);
  }
  return resolved.uri;
}

/**
 * A URL no loader can resolve, standing in for a `require()` id that is not
 * a registered asset. Its scheme has no fetcher on either platform, so the
 * request fails at load time — the same way a missing file does — instead of
 * throwing from a component's render.
 */
export const UNREGISTERED_ASSET_URL = 'unregistered-asset://';

/**
 * {@linkcode resolveImageUrl} for code that runs during render: an
 * unregistered `require()` id yields {@linkcode UNREGISTERED_ASSET_URL} (and
 * a warning in development) rather than throwing.
 */
export function resolveImageUrlOrFallback(source: ImageSource): string {
  try {
    return resolveImageUrl(source);
  } catch (error) {
    if (__DEV__) {
      console.warn(
        `[react-native-nitro-image-pipeline] ${(error as Error).message}`,
      );
    }
    return UNREGISTERED_ASSET_URL;
  }
}

/**
 * A stable, per-source `recyclingKey` for `<NativeNitroImage>`: the URL
 * itself for strings, and a tag derived from the asset id for a `require()`
 * (resolving it would cost an asset-registry lookup per render for nothing
 * more than a distinct key).
 */
export function recyclingKeyFor(source: ImageSource): string {
  return typeof source === 'string' ? source : `asset:${source}`;
}
