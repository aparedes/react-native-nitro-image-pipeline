# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Install dependencies
bun install

# Type-check TypeScript
bun run typecheck

# Build the library (typecheck + bob build)
bun run build

# Run codegen (nitrogen → build → post-script)
bun run codegen

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
ios/HybridNitroImageToolkit.swift     ← iOS implementation
android/.../HybridNitroImageToolkit.kt ← Android implementation
android/.../cpp/cpp-adapter.cpp       ← JNI entry point
       ↓  [build]
lib/   ← compiled JS/TS outputs (commonjs, module, typedefs)
```

### Development Workflow

1. **Modify the spec** in `src/specs/nitro-image-toolkit.nitro.ts` (TypeScript interface)
2. **Run codegen**: `bun run codegen` — regenerates all bridge code in `nitrogen/`
3. **Implement native**: update `ios/HybridNitroImageToolkit.swift` and `android/.../HybridNitroImageToolkit.kt` to match the new spec
4. **Build**: `bun run build` compiles TypeScript

### Key Files

| File | Purpose |
|------|---------|
| `src/specs/nitro-image-toolkit.nitro.ts` | API contract — defines all methods/properties |
| `src/index.ts` | Library entry point, creates the HybridObject |
| `nitro.json` | Nitrogen codegen config (namespace, module names, language targets) |
| `NitroImageToolkit.podspec` | iOS CocoaPods spec — do not manually add source files; nitrogen autolinking handles it |
| `android/CMakeLists.txt` | C++ build config — includes nitrogen-generated cmake |

### Nitro Modules Concepts

- **HybridObject**: The core native object type. The spec TypeScript interface defines its shape; generated code creates the bridge; native classes implement the actual logic.
- **nitrogen**: CLI code generator that reads the `.nitro.ts` spec and outputs platform-specific bridge code. Run via `bun run codegen`.
- **react-native-nitro-modules**: The runtime package that must be a peer dependency of consuming apps.

## Requirements

- React Native v0.76.0+ (v0.78.0+ for Nitro Views)
- Node 18.0.0+
- Bun (package manager)
- NDK 27.1.12297006 (Android)

## Release

Uses `semantic-release` with conventional commits on `main` branch. Running `bun run release` will version, publish to npm, and update CHANGELOG.md automatically.
