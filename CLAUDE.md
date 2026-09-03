# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Install dependencies
bun install

# Type-check TypeScript
bun run typecheck

# Lint + check formatting (oxlint + oxfmt)
bun run lint

# Auto-fix lint issues and format
bun run lint:fix

# Build the library (typecheck + bob build)
bun run build

# Run codegen (nitrogen → build → post-script)
bun run codegen

# Verify both blur kernels agree (macOS + Xcode; runs in the iOS CI job)
bun run verify:blur

# Clean all generated/build artifacts
bun run clean
```

For the example app:
```bash
cd example
bun install
bun run ios     # or bun run android
```

## Architecture

This library is built with [Nitro Modules](https://nitro.margelo.com/), a framework for creating high-performance React Native native modules via C++ hybrid objects.

### Layer Stack

```
TypeScript API (src/specs/*.nitro.ts)
       ↓  [nitrogen codegen]
nitrogen/generated/   ← NEVER edit these files manually
  ├── shared/c++/     ← cross-platform C++ specs
  ├── ios/swift/      ← Swift protocol/base class
  ├── ios/c++/        ← C++ ↔ Swift bridge
  ├── android/kotlin/ ← Kotlin abstract class
  └── android/c++/    ← JNI bindings
       ↓  [implement]
ios/HybridNitroImagePipeline.swift     ← iOS implementation
android/.../HybridNitroImagePipeline.kt ← Android implementation
android/.../cpp/cpp-adapter.cpp       ← JNI entry point
       ↓  [build]
lib/   ← compiled JS/TS outputs (commonjs, module, typedefs)
```

### Development Workflow

1. **Modify the spec** in `src/specs/nitro-image-toolkit.nitro.ts` (TypeScript interface)
2. **Run codegen**: `bun run codegen` — regenerates all bridge code in `nitrogen/`
3. **Implement native**: update `ios/HybridNitroImagePipeline.swift` and `android/.../HybridNitroImagePipeline.kt` to match the new spec
4. **Build**: `bun run build` compiles TypeScript

### Key Files

| File | Purpose |
|------|---------|
| `src/specs/nitro-image-toolkit.nitro.ts` | API contract — defines all methods/properties |
| `ios/GaussianBlur.swift` | iOS blur kernel (Accelerate) — no UIKit/Nuke, so `scripts/verify-blur.swift` can compile it on the host |
| `ios/GaussianBlurProcessor.swift` | UIImage + Nuke `ImageProcessing` plumbing around that kernel |
| `scripts/verify-blur.swift` | Host-side blur checks, run by `bun run verify:blur` and in CI |
| `android/src/main/cpp/GaussianBlur.cpp` | Android blur kernel (C++, no JNI/Android headers) — a port of the iOS one, so `scripts/verify-blur.swift` can compile it on the host too |
| `android/.../transform/BlurTransformation.kt` | Coil `Transformation` around that kernel, via the JNI entry point in `android/src/main/cpp/GaussianBlurJni.cpp` |
| `ios/PipelineImageLoader.swift` / `android/.../PipelineImageLoader.kt` | Native `ImageLoader` (react-native-nitro-image) impls behind `createImageLoader` — the view loads at its laid-out size on attach, cancels on detach; `ViewOptions` are points, converted to pixels natively |
| `src/index.ts` | Library entry point — re-exports only |
| `src/NitroImagePipeline.ts` | Creates the HybridObject |
| `src/useImage.ts` | Hook; `enabled` defers loading |
| `src/resizeForStyle.ts` | Points → bitmap-pixel `resize` helpers |
| `src/resolveImageSource.ts` | `ImageSource` (`string \| number`) and `resolveImageUrl` — turns a `require()` into the URL string the native side loads |
| `src/PipelineImage.tsx` | `NativeNitroImage` wrapper that derives `resize` from `style`/`onLayout`; its `blur`/`cornerRadius` are in points |
| `src/usePipelineImageLoader.ts` | Hook; value-memoized `ImageLoader` for `<NativeNitroImage image={...}>` |
| `src/NativePipelineImage.tsx` | Fully native-driven image component — no JS work per image after mount; no `onLoad`/`onError` |
| `nitro.json` | Nitrogen codegen config (namespace, module names, language targets) |
| `NitroImagePipeline.podspec` | iOS CocoaPods spec — do not manually add source files; nitrogen autolinking handles it |
| `android/CMakeLists.txt` | C++ build config — includes nitrogen-generated cmake |
| `.oxlintrc.json` / `.oxfmtrc.json` | Lint and format config (oxlint + oxfmt) |
| `.oxlint/react-native-plugin.mjs` | Vendored React Native lint rules — oxlint has no native `react-native` plugin |
| `lefthook.yml` | Git hooks — pre-commit formats/lints staged files, pre-push runs the full checks |
| `.swiftlint.yml` | SwiftLint config (excludes `nitrogen/generated`, Pods, build output) |

### Blur is a cross-platform contract

`blur` (and `gaussianBlur`'s `radius`) is the **standard deviation (sigma) of the Gaussian, in
source-image pixels**, and the two platforms are calibrated to agree on it. Neither side may pass
the value to its native blur unchanged:

- iOS (`ios/GaussianBlur.swift`) runs three `vImageBoxConvolve_ARGB8888` passes whose widths are
  solved for the requested sigma. `CIGaussianBlur` is deliberately not used — its `inputRadius`
  measures ≈ `1.18 × sigma` and it fades image borders.
- Android (`android/src/main/cpp/GaussianBlur.cpp`) is a port of that kernel: the same
  `boxSizes(forSigma:)` search and the same three passes, each a separable box that rounds to 8 bits
  once, run in place on the `ARGB_8888` bitmap through `AndroidBitmap_lockPixels`. There is no
  RenderScript, no radius cap and no downscaling.

Both clamp at the edges rather than sampling past them: vImage via `kvImageEdgeExtend`, the C++
kernel by clamping the sample coordinate. That is what keeps blurred images from fading out at their
borders.

Changing either kernel means re-checking both against the same sigma — `bun run verify:blur`
compiles both kernels for the host and asserts they pick the same box widths, measure the same sigma
and produce byte-identical output on the same image.

### Nitro Modules Concepts

- **HybridObject**: The core native object type. The spec TypeScript interface defines its shape; generated code creates the bridge; native classes implement the actual logic.
- **nitrogen**: CLI code generator that reads the `.nitro.ts` spec and outputs platform-specific bridge code. Run via `bun run codegen`.
- **react-native-nitro-modules**: The runtime package that must be a peer dependency of consuming apps.

## Git Hooks

`bun install` installs [lefthook](https://lefthook.dev) hooks automatically.

- **pre-commit** (staged files only): `oxfmt` and `ktfmt` format and re-stage; `oxlint --deny-warnings` and `swiftlint --strict` block the commit on failure.
- **pre-push**: the above across the whole repo, plus `tsc --noEmit`.

`ktfmt` and `swiftlint` are not npm packages — install them with `brew install ktfmt swiftlint`. Jobs needing a missing tool are skipped, not failed. Bypass a run with `LEFTHOOK=0 git commit`.

Kotlin uses ktfmt's default **Meta** style (2-space blocks, 4-space continuations), which is what the existing sources already follow.

## Requirements

- React Native v0.76.0+ (v0.78.0+ for Nitro Views)
- Node 18.0.0+
- Bun (package manager)
- NDK 27.1.12297006 (Android)
- ktfmt + swiftlint for the native lint hooks (`brew install ktfmt swiftlint`)

## Release

Uses `semantic-release` with conventional commits on `main` branch. Running `bun run release` will version, publish to npm, and update CHANGELOG.md automatically.
