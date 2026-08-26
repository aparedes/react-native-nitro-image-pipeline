## [1.1.0](https://github.com/[secure]/react-native-nitro-image-pipeline/compare/v1.0.0...v1.1.0) (2026-08-26)

### ✨ Features

* support per-corner cornerRadius in loadImage ([#75](https://github.com/[secure]/react-native-nitro-image-pipeline/issues/75)) ([8894aa7](https://github.com/[secure]/react-native-nitro-image-pipeline/commit/8894aa75036b5350ab775aa38a76c9371652f92b))

## [1.0.0](https://github.com/[secure]/react-native-nitro-image-pipeline/compare/v0.3.5...v1.0.0) (2026-08-25)

### ⚠ BREAKING CHANGES

* `blur` and `gaussianBlur`'s `radius` are now a Gaussian sigma
in source-image pixels rather than each platform's native radius. On iOS,
multiply previous values by ~1.18 to keep the same look; on Android the old
result depended on the source image's resolution, so values need re-tuning.
See "Upgrading from 0.3.x" in the README.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>

* Update Podfile.lock

* fix(ios): avoid inferred min(by:) chain that Swift 6.2 cannot type-check

Xcode 26.3 fails the pod build with "type of expression is ambiguous" on
boxSizes' map/min(by:) chain. It type-checks in isolation — the verify:blur
step compiles the same file on the same toolchain and passes — but inside the
pod target, with Nuke, NitroModules and UIKit imported, the solver has far more
'-' and abs overloads to consider and gives up.

Rewrite the candidate search and the standard-deviation helper as plain loops
with explicit Double annotations, so there is no overload search left to do.
Same output: the candidate closest to the requested sigma still wins, ties
still go to the first. Give verify-blur.swift's zip/reduce chains the same
treatment before they hit the same wall.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>

* fix(ios): use .magnitude instead of abs() in the blur kernel

Nitro's C++ interop brings std::abs overloads into the pod target, and Swift
6.2 (Xcode 26.3) reports "ambiguous use of 'abs'" there. It resolves fine on
6.4, and on any toolchain when the file is compiled alone, which is why neither
local builds nor the verify:blur step caught it.

`.magnitude` is a property on Double, so there is no overload set to resolve.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>

### ✨ Features

* normalize blur to a Gaussian sigma in source pixels ([#68](https://github.com/[secure]/react-native-nitro-image-pipeline/issues/68)) ([018d0a8](https://github.com/[secure]/react-native-nitro-image-pipeline/commit/018d0a8faf1b1f5cb2970510e6732bfc80770005))

### 🛠️ Other changes

* **ci:** upgrade workflow actions and pin bun to >=1.4.0 ([#66](https://github.com/[secure]/react-native-nitro-image-pipeline/issues/66)) ([d075a87](https://github.com/[secure]/react-native-nitro-image-pipeline/commit/d075a87270c7c0aaa32527e848d1111b21b6b142))
* **deps:** pin conventional-changelog-conventionalcommits to v9 ([#69](https://github.com/[secure]/react-native-nitro-image-pipeline/issues/69)) ([6da7f1a](https://github.com/[secure]/react-native-nitro-image-pipeline/commit/6da7f1a707ac438f25e2e42df999f548d46ed7f4))
* replace Biome with oxlint + oxfmt, add lefthook hooks ([#67](https://github.com/[secure]/react-native-nitro-image-pipeline/issues/67)) ([643f359](https://github.com/[secure]/react-native-nitro-image-pipeline/commit/643f3590e4b9935b02551362e6a130fab281779a))

## [0.3.5](https://github.com/[secure]/react-native-nitro-image-pipeline/compare/v0.3.4...v0.3.5) (2026-08-25)

## [0.3.4](https://github.com/[secure]/react-native-nitro-image-pipeline/compare/v0.3.3...v0.3.4) (2026-08-03)

## [0.3.3](https://github.com/aparedes/react-native-nitro-image-pipeline/compare/v0.3.2...v0.3.3) (2026-07-12)

### 🐛 Bug Fixes

* **ios:** only apply blur/cornerRadius processors when requested ([#60](https://github.com/aparedes/react-native-nitro-image-pipeline/issues/60)) ([6dace2f](https://github.com/aparedes/react-native-nitro-image-pipeline/commit/6dace2f1d6c65d97cada5d3fb828e4d9ffa8908c))

## [0.3.2](https://github.com/aparedes/react-native-nitro-image-pipeline/compare/v0.3.1...v0.3.2) (2026-07-06)

### 🛠️ Other changes

* trigger release after fixing npm publish token ([#58](https://github.com/aparedes/react-native-nitro-image-pipeline/issues/58)) ([89b2a95](https://github.com/aparedes/react-native-nitro-image-pipeline/commit/89b2a9509ba09e08b6d19a5a682c36c65a7b489d))

## [0.3.1](https://github.com/aparedes/react-native-nitro-image-pipeline/compare/v0.3.0...v0.3.1) (2026-07-06)

### 🛠️ Other changes

* bump GitHub Actions to Node 24 runtime versions ([#57](https://github.com/aparedes/react-native-nitro-image-pipeline/issues/57)) ([efe5e87](https://github.com/aparedes/react-native-nitro-image-pipeline/commit/efe5e875c3a57c2931b9a292fa268d444f3d5d13))

## [0.3.0](https://github.com/aparedes/react-native-nitro-image-pipeline/compare/v0.2.0...v0.3.0) (2026-04-21)

### ✨ Features

* Add React Native Harness tests and CI workflow ([#30](https://github.com/aparedes/react-native-nitro-image-pipeline/issues/30)) ([64880e1](https://github.com/aparedes/react-native-nitro-image-pipeline/commit/64880e1190f3d553c39c02305b3bd73db6b4dd72))
* Bump nitrogen and react-native-nitro-modules to 0.35.4 ([#31](https://github.com/aparedes/react-native-nitro-image-pipeline/issues/31)) ([315c375](https://github.com/aparedes/react-native-nitro-image-pipeline/commit/315c3753e21d119b57bfc0f5ef4042670d118161))

## [0.2.0](https://github.com/aparedes/react-native-nitro-image-pipeline/compare/v0.1.1...v0.2.0) (2026-04-06)

### ✨ Features

* respect cache option for image loading ([8124543](https://github.com/aparedes/react-native-nitro-image-pipeline/commit/812454352d3ffa004ec3c5e3dd15d148bebfaf75))

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
