# react-native-nitro-toolkit — Implementation Plan

A Nitro Module that provides image processing utilities (blur, brightness, etc.) with a two-tier cache system, built on top of `react-native-nitro-image`.

## Overview

- **Package name:** `react-native-nitro-toolkit`
- **Dependencies:** `react-native-nitro-modules`, `react-native-nitro-image`
- **Native languages:** Swift (iOS), Kotlin (Android)
- **Architecture:** Single `ImageToolkit` HybridObject exposing processing methods + cache, with a JS-side `ImagePipeline` chaining API and `useProcessedImage` hook

---

## 1. Scaffold the Module

Use `npx nitrogen@latest init react-native-nitro-toolkit` to generate the project structure.

### Tooling ✅

Prettier and ESLint (`@react-native` config) have been replaced with **Biome** (`@biomejs/biome`).

Config (`biome.json`):
- 2-space indent, single quotes, double quotes for JSX, trailing commas, semicolons
- Import sorting via `assist.actions.source.organizeImports`
- `useExhaustiveDependencies` included in recommended rules

Scripts:
- `bun run lint` → `biome check .`
- `bun run format` → `biome format --write .`

Zed format-on-save configured via `.zed/settings.json`.

### nitro.json

```json
{
  "$schema": "https://nitro.margelo.com/nitro.schema.json",
  "cxxNamespace": ["toolkit"],
  "ios": {
    "iosModuleName": "NitroToolkit"
  },
  "android": {
    "androidNamespace": ["toolkit"],
    "androidCxxLibName": "NitroToolkit"
  },
  "autolinking": {
    "ImageToolkit": {
      "ios": {
        "language": "swift",
        "implementationClassName": "HybridImageToolkit"
      },
      "android": {
        "language": "kotlin",
        "implementationClassName": "HybridImageToolkit"
      }
    }
  }
}
```

### Native dependencies

- **iOS podspec:** Add `NitroImage` as a dependency
- **Android build.gradle:** Add `:react-native-nitro-image` to dependencies
- **Android CMake:** Add `react-native-nitro-image::NitroImage` as a prefab dependency
- **JS package.json:** Add `react-native-nitro-image` to `peerDependencies` and `devDependencies`

---

## 2. Nitro Spec

File: `src/specs/ImageToolkit.nitro.ts`

```typescript
import { type HybridObject } from 'react-native-nitro-modules'
import { type Image } from 'react-native-nitro-image'

export interface ImageToolkit extends HybridObject<{
  ios: 'swift',
  android: 'kotlin'
}> {
  // Processing
  gaussianBlur(image: Image, radius: number): Promise<Image>
  // Future: brightness, saturation, tint, etc.

  // Cache — two-tier (in-memory L1 + disk L2)
  getCached(key: string): Promise<Image | undefined>
  cache(image: Image, key: string): Promise<void>
  evict(key: string): Promise<void>
  clearCache(): Promise<void>

  // Cache config
  setMaxDiskCacheSize(bytes: number): void
  setMaxMemoryCacheCount(count: number): void
  getDiskCacheSize(): Promise<number>
}
```

After writing this, run `npx nitrogen` to generate native specs.

---

## 3. iOS Implementation (Swift)

File: `ios/HybridImageToolkit.swift`

### Blur

- Use Core Image's `CIGaussianBlur` filter — GPU-accelerated via Metal internally
- Receive `any HybridImageSpec`, downcast to `HybridImage` to access `.uiImage`
- Apply the filter, create a new `HybridImage` from the result
- ✅ `HybridImage.init(uiImage: UIImage)` is public — confirmed from source

```swift
func gaussianBlur(image: any HybridImageSpec, radius: Double) async throws -> any HybridImageSpec {
    guard let nativeImage = image as? HybridImage else {
        throw NSError(domain: "NitroToolkit", code: 1,
            userInfo: [NSLocalizedDescriptionKey: "Unsupported image type"])
    }
    let uiImage = nativeImage.uiImage

    guard let ciImage = CIImage(image: uiImage) else { throw ... }
    let filter = CIFilter(name: "CIGaussianBlur")!
    filter.setValue(ciImage, forKey: kCIInputImageKey)
    filter.setValue(radius, forKey: kCIInputRadiusKey)

    let context = CIContext()
    guard let output = filter.outputImage,
          let cgImage = context.createCGImage(output, from: ciImage.extent)
    else { throw ... }

    return HybridImage(uiImage: UIImage(cgImage: cgImage))
}
```

### Cache

- **L1:** `NSCache<NSString, HybridImage>` — in-memory, auto-evicts on memory pressure
- **L2:** Disk cache in `FileManager.cachesDirectory/NitroToolkit/`
- Keys are SHA256 hashed for safe filenames
- Disk format: JPEG at 90% quality (blurred images don't need lossless)
- Flow: L1 hit → return. L2 hit → load into L1, return. Miss → return nil.

```swift
private let memoryCache = NSCache<NSString, HybridImage>()
private let diskCacheDir: URL  // Caches/NitroToolkit/

func getCached(key: String) async throws -> (any HybridImageSpec)? {
    // Check L1 (memory)
    if let cached = memoryCache.object(forKey: key as NSString) {
        return cached
    }
    // Check L2 (disk)
    let file = diskCacheDir.appendingPathComponent(key.sha256 + ".jpg")
    guard FileManager.default.fileExists(atPath: file.path),
          let uiImage = UIImage(contentsOfFile: file.path) else {
        return nil
    }
    let image = HybridImage(uiImage: uiImage)
    memoryCache.setObject(image, forKey: key as NSString)
    return image
}

func cache(image: any HybridImageSpec, key: String) async throws {
    guard let native = image as? HybridImage else { return }
    memoryCache.setObject(native, forKey: key as NSString)
    let file = diskCacheDir.appendingPathComponent(key.sha256 + ".jpg")
    let data = native.uiImage.jpegData(compressionQuality: 0.9)
    try data?.write(to: file)
}
```

---

## 4. Android Implementation (Kotlin)

File: `android/src/main/java/.../HybridImageToolkit.kt`

### Blur

- Use AndroidX `androidx.core.graphics:core-ktx` Toolkit blur (replacement for deprecated RenderScript)
- Downcast `HybridImageSpec` to `HybridImage` to access the `Bitmap`
- Apply blur, wrap result in new `HybridImage`
- ✅ `HybridImage(bitmap: Bitmap)` constructor is public — confirmed from source

```kotlin
override fun gaussianBlur(image: HybridImageSpec, radius: Double): Promise<HybridImageSpec> = Promise.async {
    val nativeImage = image as? HybridImage
        ?: throw Error("Unsupported image type")
    val bitmap = nativeImage.bitmap
    val blurredBitmap = Toolkit.blur(bitmap, radius.toInt().coerceIn(1, 25))
    return@async HybridImage(blurredBitmap)
}
```

### Cache

- **L1:** `LruCache<String, HybridImage>` — in-memory
- **L2:** Disk cache in `context.cacheDir/NitroToolkit/`
- Same SHA256 key hashing, JPEG format
- Same L1 → L2 → miss flow as iOS

---

## 5. JS Layer

### ImagePipeline (chaining API with auto-keying)

File: `src/ImagePipeline.ts`

```typescript
import { type Image } from 'react-native-nitro-image'
import { NitroModules } from 'react-native-nitro-modules'
import type { ImageToolkit } from './specs/ImageToolkit.nitro'

const toolkit = NitroModules.createHybridObject<ImageToolkit>('ImageToolkit')

type Op = {
  name: string
  params: number[]
  exec: (img: Image) => Promise<Image>
}

export class ImagePipeline {
  private ops: Op[] = []
  private sourceKey: string

  constructor(sourceKey: string) {
    this.sourceKey = sourceKey
  }

  blur(radius: number) {
    this.ops.push({
      name: 'gaussianBlur',
      params: [radius],
      exec: (img) => toolkit.gaussianBlur(img, radius),
    })
    return this
  }

  // Future: brightness(amount), saturation(amount), tint(color), etc.

  get cacheKey(): string {
    const opsString = this.ops
      .map((op) => `${op.name}:${op.params.join(',')}`)
      .join('|')
    return `${this.sourceKey}|${opsString}`
  }

  async apply(image: Image): Promise<Image> {
    const key = this.cacheKey

    const cached = await toolkit.getCached(key)
    if (cached) return cached

    let result = image
    for (const op of this.ops) {
      result = await op.exec(result)
    }

    await toolkit.cache(result, key)
    return result
  }
}
```

Auto-key format: `sha256("<sourceUrl>|gaussianBlur:10|brightness:1.2")`
Same source + same operations = cache hit. Any parameter change = automatic invalidation.

### useProcessedImage Hook

File: `src/useProcessedImage.ts`

```typescript
import { useState, useEffect, useMemo } from 'react'
import { type Image, loadImage, type ImageSource } from 'react-native-nitro-image'
import { ImagePipeline } from './ImagePipeline'

export function useProcessedImage(
  source: ImageSource,
  configure: (pipeline: ImagePipeline) => ImagePipeline
) {
  const [result, setResult] = useState<Image | null>(null)
  const [loading, setLoading] = useState(true)

  const sourceKey = typeof source === 'object' && 'url' in source
    ? source.url
    : JSON.stringify(source)

  const pipeline = useMemo(
    () => configure(new ImagePipeline(sourceKey)),
    [sourceKey, configure]
  )

  useEffect(() => {
    let cancelled = false
    setLoading(true)

    async function load() {
      // 1. Check disk cache — no network needed on hit
      const cached = await toolkit.getCached(pipeline.cacheKey)
      if (cached) {
        if (!cancelled) {
          setResult(cached)
          setLoading(false)
        }
        return
      }

      // 2. Cache miss — download original
      const original = await loadImage(source)
      if (cancelled) return

      // 3. Process through pipeline (which also caches the result)
      const processed = await pipeline.apply(original)
      if (!cancelled) {
        setResult(processed)
        setLoading(false)
      }
    }

    load()
    return () => { cancelled = true }
  }, [pipeline.cacheKey])

  return { image: result, loading }
}
```

### Usage Example

```typescript
import { useProcessedImage } from 'react-native-nitro-toolkit'
import { NitroImage } from 'react-native-nitro-image'

function BlurredAvatar({ url }: { url: string }) {
  const { image, loading } = useProcessedImage(
    { url },
    (p) => p.blur(10)
  )

  if (!image) return null // or a placeholder

  return <NitroImage image={image} style={{ width: 200, height: 200 }} />
}
```

---

## 6. Build Order

1. **Scaffold:** `npx nitrogen@latest init react-native-nitro-toolkit`
2. **Tooling:** ✅ Biome replaces Prettier + ESLint
3. **Dependencies:** Add `react-native-nitro-image` to podspec, gradle, and package.json
3. **Spec:** Write `ImageToolkit.nitro.ts`, run `npx nitrogen`
4. ✅ **HybridImage constructors verified:** `HybridImage.init(uiImage:)` (iOS) and `HybridImage(bitmap:)` (Android) are public. Cast to `HybridImage`, not `NativeImage` (`NativeImage` is a protocol, `HybridImage` is the concrete class).
5. **iOS:** Implement `HybridImageToolkit.swift` — gaussianBlur (CIGaussianBlur) + two-tier cache (NSCache + disk)
6. **Android:** Implement `HybridImageToolkit.kt` — Toolkit blur + two-tier cache (LruCache + disk)
7. **JS:** Build `ImagePipeline` class + `useProcessedImage` hook
8. **Example app:** Set up with `create-expo-app`, test blur + cache hit/miss
9. **Add more effects:** Each new effect = one new method on the spec + one CIFilter (iOS) + one operation (Android)

---

## Key Risks & Decisions

| Risk | Mitigation |
|------|-----------|
| ~~`NativeImage` may not have public init from UIImage/Bitmap~~ | ✅ Resolved — use `HybridImage` (concrete class). `NativeImage` is a protocol. |
| Android Toolkit blur radius capped at 25 | For larger radii, downscale → blur → upscale, or apply multiple passes |
| Disk cache grows unbounded | Implement `setMaxDiskCacheSize` with LRU eviction by file access time |
| `configure` callback in hook causes re-renders | Cache key comparison in useEffect deps prevents re-processing |
| Large images cause memory spikes during blur | Consider downsampling before blur if image dimensions exceed a threshold |
