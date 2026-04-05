## [0.1.1](https://github.com/aparedes/react-native-nitro-image-pipeline/compare/v0.1.0...v0.1.1) (2026-04-05)

### 🐛 Bug Fixes

* pin lodash-es to 4.17.21 to fix semantic-release ([#15](https://github.com/aparedes/react-native-nitro-image-pipeline/issues/15)) ([47ee4f6](https://github.com/aparedes/react-native-nitro-image-pipeline/commit/47ee4f6dfd622154f27b1a0e1a4f60bd600aa464))

# Changelog

## [0.1.0] - 2026-04-05

### Initial Release

High-performance React Native image loading and processing library built on [Nitro Modules](https://nitro.margelo.com/).

#### Features

**Image Loading**
- Load images from URLs via `loadImage(url, options?)` returning a `HybridImage`
- iOS: powered by [Nuke](https://github.com/kean/nuke)
- Android: powered by [Coil](https://coil-kt.github.io/coil/) with [Cronet](https://developer.chrome.com/docs/multidevice/cronet/)-backed OkHttp (HTTP/2 and QUIC support)

**Image Processing**
- `gaussianBlur(image, radius)` — apply Gaussian blur to a loaded image (Android: RenderScript)

**Caching**
- `cache` / `getCached` / `evict` / `clearCache` — full cache lifecycle control
- `setMaxDiskCacheSize` / `setMaxMemoryCacheCount` — configure cache limits
- `getDiskCacheSize` — inspect current disk cache usage

#### Peer Dependencies

- `react-native` 0.76.0+
- `react-native-nitro-modules` — Nitro runtime
- `react-native-nitro-image` — provides the `Image` / `HybridImageSpec` type returned by `loadImage`, `getCached`, and `gaussianBlur`

#### Platform Requirements

- iOS: Xcode 15+
- Android: NDK 27.1.12297006
