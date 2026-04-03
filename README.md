# react-native-nitro-image-toolkit

A high-performance image loading, caching, and processing library for React Native, built with [Nitro Modules](https://nitro.margelo.com/).

[![Version](https://img.shields.io/npm/v/react-native-nitro-image-toolkit.svg)](https://www.npmjs.com/package/react-native-nitro-image-toolkit)
[![Downloads](https://img.shields.io/npm/dm/react-native-nitro-image-toolkit.svg)](https://www.npmjs.com/package/react-native-nitro-image-toolkit)
[![License](https://img.shields.io/npm/l/react-native-nitro-image-toolkit.svg)](https://github.com/patrickkabwe/react-native-nitro-image-toolkit/LICENSE)

## Features

- Load remote images with built-in memory and disk caching
- Prefetch single or multiple images in the background
- Apply Gaussian blur and rounded corners at load time
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
bun add react-native-nitro-image-toolkit react-native-nitro-modules
```

## Usage

### `useImage` hook

The simplest way to load an image in a component:

```tsx
import { useImage } from 'react-native-nitro-image-toolkit';

function MyComponent() {
  const { image, error } = useImage({
    url: 'https://example.com/photo.jpg',
    blur: 4,
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
import { NitroImageToolkit } from 'react-native-nitro-image-toolkit';

// Load an image with options
const image = await NitroImageToolkit.loadImage('https://example.com/photo.jpg', {
  blur: 4,
  cornerRadius: 12,
  cache: 'disk',
});

// Prefetch a single image
await NitroImageToolkit.preLoadImage('https://example.com/photo.jpg');

// Prefetch multiple images
await NitroImageToolkit.preLoadImages([
  'https://example.com/a.jpg',
  'https://example.com/b.jpg',
]);

// Apply Gaussian blur to an already-loaded image
const blurred = await NitroImageToolkit.gaussianBlur(image, 10);

// Clear the image cache
NitroImageToolkit.clearCache();
```

## API Reference

### `loadImage(url, options?)`

Loads an image from a URL and returns a `Promise<Image>`.

| Option | Type | Default | Description |
|---|---|---|---|
| `blur` | `number` | `0` | Gaussian blur radius applied at load time |
| `cornerRadius` | `number` | `0` | Corner radius in points |
| `cache` | `'memory' \| 'disk' \| 'none'` | platform default | Caching strategy |

### `preLoadImage(url)`

Prefetches a single image into the cache. Returns `Promise<void>`.

### `preLoadImages(urls)`

Prefetches multiple images into the cache. Returns `Promise<void>`.

### `gaussianBlur(image, radius)`

Applies a Gaussian blur to an existing `Image` object. Returns `Promise<Image>`.

### `clearCache()`

Removes all cached images from memory and disk.

## Credits

Bootstrapped with [create-nitro-module](https://github.com/patrickkabwe/create-nitro-module).

## Contributing

Pull requests are welcome. For major changes, please open an issue first to discuss what you would like to change.
