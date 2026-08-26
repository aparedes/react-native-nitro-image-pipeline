# react-native-nitro-image-pipeline

A high-performance image loading, caching, and processing library for React Native, built with [Nitro Modules](https://nitro.margelo.com/).

[![Version](https://img.shields.io/npm/v/react-native-nitro-image-pipeline.svg)](https://www.npmjs.com/package/react-native-nitro-image-pipeline)
[![Downloads](https://img.shields.io/npm/dm/react-native-nitro-image-pipeline.svg)](https://www.npmjs.com/package/react-native-nitro-image-pipeline)
[![License](https://img.shields.io/npm/l/react-native-nitro-image-pipeline.svg)](https://github.com/aparedes/react-native-nitro-image-pipeline/LICENSE)

## Features

- Load remote images with built-in memory and disk caching
- Prefetch single or multiple images in the background
- Apply Gaussian blur and rounded corners (uniform or per-corner) at load time
- Apply Gaussian blur to already-loaded images
- Clear the image cache on demand
- `useImage` hook for declarative image loading in components

## Requirements

- React Native v0.76.0 or higher
- Node 18.0.0 or higher

> [!IMPORTANT]
> To support `Nitro Views` you need React Native v0.78.0 or higher.

## Installation

```bash
# npm
npm install react-native-nitro-image-pipeline react-native-nitro-modules react-native-nitro-image

# pnpm
pnpm add react-native-nitro-image-pipeline react-native-nitro-modules react-native-nitro-image

# bun
bun add react-native-nitro-image-pipeline react-native-nitro-modules react-native-nitro-image
```

## Usage

### `useImage` hook

The simplest way to load an image in a component:

```tsx
import { useImage } from 'react-native-nitro-image-pipeline';

function MyComponent() {
  const { image, error } = useImage({
    url: 'https://example.com/photo.jpg',
    blur: 4, // Gaussian sigma in source pixels — same result on iOS and Android
    cornerRadius: 12,
  });

  if (error) return <Text>Failed to load image</Text>;
  if (!image) return <ActivityIndicator />;

  // use `image` with react-native-nitro-image
  return <NitroImage source={image} />;
}
```

### Direct API

```ts
import { NitroImagePipeline } from 'react-native-nitro-image-pipeline';

// Load an image with options
const image = await NitroImagePipeline.loadImage('https://example.com/photo.jpg', {
  blur: 4, // Gaussian sigma in source pixels — see "Blur units"
  cornerRadius: 12,
  cache: 'disk',
});

// Per-corner radii — e.g. a "ticket" shape with larger bottom corners.
// The rounding is baked into the bitmap, so no view-layer masking is needed.
const ticket = await NitroImagePipeline.loadImage('https://example.com/photo.jpg', {
  cornerRadius: { topLeft: 24, topRight: 24, bottomLeft: 48, bottomRight: 48 },
});

// Prefetch a single image
await NitroImagePipeline.preLoadImage('https://example.com/photo.jpg');

// Prefetch multiple images
await NitroImagePipeline.preLoadImages([
  'https://example.com/a.jpg',
  'https://example.com/b.jpg',
]);

// Apply Gaussian blur to an already-loaded image
const blurred = await NitroImagePipeline.gaussianBlur(image, 10);

// Clear the image cache
await NitroImagePipeline.clearCache();
```

## API Reference

### `loadImage(url, options?)`

Loads an image from a URL and returns a `Promise<Image>`.

| Option | Type | Default | Description |
|---|---|---|---|
| `blur` | `number` | `0` | Gaussian blur strength applied at load time — see [Blur units](#blur-units) |
| `cornerRadius` | `number \| CornerRadii` | `0` | Corner radius in points — a single number for all four corners, or `{ topLeft?, topRight?, bottomLeft?, bottomRight? }` for independent per-corner radii (omitted corners stay square) |
| `cache` | `'memory' \| 'disk' \| 'none'` | platform default | Caching strategy |

### `preLoadImage(url)`

Prefetches a single image into the cache. Returns `Promise<void>`.

### `preLoadImages(urls)`

Prefetches multiple images into the cache. Returns `Promise<void>`.

### `gaussianBlur(image, radius)`

Applies a Gaussian blur to an existing `Image` object. Returns `Promise<Image>`. `radius` uses the
same unit as the `blur` option — see [Blur units](#blur-units).

### Blur units

`blur` (and `gaussianBlur`'s `radius`) is the **standard deviation (sigma) of the Gaussian, in
source-image pixels**. The same value on the same source file produces the same result on iOS and
Android — the platforms are calibrated against each other rather than each exposing its native
backend's own idea of "radius".

```ts
// ~11px of blur on both platforms, whatever the device
await NitroImagePipeline.loadImage(url, { blur: 11 });
```

Two things follow from the unit being *source* pixels:

- Blur is measured against the image's own resolution, not the size it is displayed at. A 4000px
  photo at `blur: 11` looks subtler than a 400px thumbnail at `blur: 11`. To keep a feed visually
  consistent, scale the value with the source width.
- Coming from React Native's `<Image blurRadius={n} />`? That halves its input internally, so
  `blurRadius={n}` ≈ `blur: n / 2`. RN's value is also density-scaled on Android and not on iOS,
  which is why the two never quite matched there.

Values below ~1 are smaller than the smallest kernel either backend can build and are effectively a
no-op. There is no upper bound.

Implementation: iOS runs three Accelerate box-convolution passes sized to hit the requested sigma
(the standard three-box Gaussian approximation, accurate to a few percent); Android uses
RenderScript's true Gaussian, downscaling first when sigma exceeds the single-pass ceiling of
~10.6px and compensating the radius so the result is unchanged. Both clamp at the edges, so blurred
images keep their borders instead of fading out.

### `clearCache()`

Removes all cached images from memory and disk. Returns `Promise<void>` that resolves once both caches are cleared.

## Upgrading from 0.3.x

`blur` and `gaussianBlur(image, radius)` changed meaning in 1.0. They used to hand the number
straight to each platform's native blur, and the two platforms disagreed about what it meant; now
both read it as a Gaussian sigma in source-image pixels (see [Blur units](#blur-units)).

| | what `blur: n` did in 0.3.x | what it does in 1.0 |
|---|---|---|
| iOS | fed `n` to `CIGaussianBlur(inputRadius:)`, measured at `sigma ≈ 1.18 × n` | `sigma = n` |
| Android | RenderScript on a copy downscaled to 512px, so strength scaled with the source resolution: `sigma ≈ (0.4n + 0.6) × max(w, h) / 512` | `sigma = n`, resolution-independent |

To keep the look you had:

- **iOS:** multiply your old value by ~1.18 (`blur: 10` → `blur: 12`).
- **Android:** there is no single factor — the old result depended on the source image's
  resolution. Re-tune against iOS, which the two platforms now agree with.

Also changed:

- `blur` above 25 used to reject the promise on Android. Sigma is now unbounded.
- Fractional values used to be truncated to whole numbers on iOS. They are honoured now.
- Blurred images used to fade out at the borders on iOS. Edges are clamped on both platforms now.

## Credits

Bootstrapped with [create-nitro-module](https://github.com/patrickkabwe/create-nitro-module).

## Contributing

Pull requests are welcome. For major changes, please open an issue first to discuss what you would like to change.
