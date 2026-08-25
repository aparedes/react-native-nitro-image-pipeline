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

# Verify the blur kernel (macOS + Xcode; runs in the iOS CI job)
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
| `android/.../transform/BlurTransformation.kt` | Android blur kernel (RenderScript) as a Coil `Transformation` |
| `src/index.ts` | Library entry point, creates the HybridObject |
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
- Android (`transform/BlurTransformation.kt`) inverts RenderScript's `sigma = 0.4 × radius + 0.6`
  and, because `radius` caps at 25, blurs a downscaled copy for sigma above ~10.6px — compensating
  the radius so the result is unchanged.

Both clamp at the edges rather than sampling past them: vImage via `kvImageEdgeExtend`, RenderScript
via `std::max/min` on the sample coordinate (see `OneVU4` in AOSP's blur). That is what keeps blurred
images from fading out at their borders.

Changing either kernel means re-checking both against the same sigma — `bun run verify:blur` covers
the iOS side.

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
