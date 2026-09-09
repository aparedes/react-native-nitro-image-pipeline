# Plan: `fit` / `allowUpscale` for `resize` (every `resizeMode`)

> [!NOTE]
> Implemented on this branch — kept as the design record. Where the code and this document
> differ, the code and `README.md` are current. Two things changed in the doing: the iOS thumbnail
> decode stays aspect-fill for `contain` too (a proportional over-decode the processor then
> shrinks, the same input Android's `Scale.FILL` produces, rather than a CGImageSource-rounded
> aspect-fit thumbnail), and Android's `RoundedCornersTransformation` is replaced by the
> pipeline's own only for the non-default fits, as planned, with the default fit's uniform-radius
> constructor preserved for its cache key.

Source request: gist `alejandro-paredes-at-work/125f8c1affd33a5848ee0a8d8ebd50e0`
("add a `fit` option covering every resize mode"). This document adapts that request to how the
library is actually built today and lays out the implementation order, the shared geometry both
platforms must agree on, and the tests that pin it.

**Base branch: `claude/nativepipelineimage-onload-onerror-vdy7vm`** (unmerged, PR #91; "feat: add
onLoad/onError to NativePipelineImage" plus a series of fixes on top of v1.6.0, at `ba2ea67` when
this was written — it is still moving, so rebase again before starting). It touches the same files this work
touches — `ViewOptions` in the spec, `usePipelineImageLoader`, `NativePipelineImage`, both
`PipelineImageLoader`s, the loader harness and the README — so branch from it, not from `main`.
If it merges first, rebase onto `main`; either way, never hand-merge `nitrogen/generated/**` — run
`bun run codegen` after the rebase and commit whatever it produces. Section 12 lists everything
that branch changes for this plan.

## 1. Where the gist and the codebase disagree

Read these first — they change the API surface before any code is written.

| # | Gist says | What the code says | Decision |
|---|-----------|--------------------|----------|
| 1 | `ResizeFit` has five values incl. `'repeat'`, and `<NativePipelineImage resizeMode="repeat">` should Just Work | `react-native-nitro-image` 0.15.1 (`src/specs/ImageView.nitro.ts`) defines `ResizeMode = 'cover' \| 'contain' \| 'center' \| 'stretch'`. There is no `repeat`; the native view (`HybridImageView.swift` / `.kt`) cannot tile. `resizeMode="repeat"` would not even type-check. | **Ship four values**: `ResizeFit = 'cover' \| 'contain' \| 'stretch' \| 'center'`. It then mirrors nitro-image's `ResizeMode` 1:1, so inference is a pass-through. `repeat`'s pipeline semantics ("leave the bitmap at natural size") are exactly `resize: undefined`, which already exists. Add `'repeat'` later only if nitro-image grows it. |
| 2 | `fit` / `allowUpscale` live inside `ResizeOptions` | True for `Options` (used by `loadImage` / `useImage`), where `fit` is meaningless without a box. But `ViewOptions.resize` is an *explicit pixel override* that is almost never set — the box normally comes from the view natively. | `ResizeOptions` gets `fit` + `allowUpscale` (as the gist says). `ViewOptions` **also** gets top-level `fit` + `allowUpscale`, applied to whatever box the loader ends up with (measured or explicit). If both are set, `resize.fit` wins over `fit`. |
| 3 | "`fit: 'center'` is a bounded decode" | Neither Nuke nor Coil can *region*-decode through the normal request path. Under `center`, subsampling must be off (a subsampled decode would crop the wrong pixels). | First version: full decode, then centre-crop. Document it (a `center` load of a 48 MP photo decodes the whole thing). Region decode (`CGImageSourceCreateThumbnailAtIndex` cannot; `BitmapRegionDecoder` on Android can) is a follow-up. |
| 4 | `<PipelineImage resizeMode="center">` should look the same on both platforms | Pre-existing gap: iOS `contentMode = .center` draws a UIImage at its *point* size, and the pipeline decodes at `scale = 1`, so a 400 px bitmap shows as 400 pt on iOS but 400 px on Android. | Fix in the view path only (`ios/PipelineImageLoader.swift`): re-wrap the final `UIImage` with the view's display scale before assigning it. Costs one wrapper object, does not touch the cache or `loadImage` results. |
| 5 | `cover` output must be byte-identical to 1.6.0 | Nuke's `ImageProcessors.Resize(aspectFill, crop: true)` ignores `upscale`, and Coil's `RoundedCornersTransformation` scale-fills to the *request* size on its own. | Keep the existing `cover` + `allowUpscale: true` code path (and cache keys) untouched. Every other combination goes through new, pipeline-owned processors. |

## 2. Public API

`src/specs/nitro-image-toolkit.nitro.ts`:

```ts
/** How the source is fitted into `width` × `height`. Mirrors NativeNitroImage's `resizeMode`. */
export type ResizeFit = 'cover' | 'contain' | 'stretch' | 'center';

export interface ResizeOptions {
  width: number;
  height: number;
  /** @default 'cover' */
  fit?: ResizeFit;
  /**
   * `false` clamps the scale to ≤ 1 for `cover`, `contain` and `stretch`
   * (a source smaller than the box is left at its own size and, for `cover`,
   * cropped to the box). No effect on `center`, which never scales.
   * @default true
   */
  allowUpscale?: boolean;
}

export type ViewOptions = {
  // ...existing, incl. the base branch's onLoad(width, height) / onError(message)...
  /** Fit for the box the loader measures from the view. @default 'cover' */
  fit?: ResizeFit;
  /** @default true */
  allowUpscale?: boolean;
  resize?: ResizeOptions; // unchanged; its own `fit`/`allowUpscale` win if set
};
```

Nitrogen turns the union into a C++/Swift/Kotlin enum exactly like `CacheOption` (see
`nitrogen/generated/ios/swift/CacheOption.swift`). Run `bun run codegen` and commit the regenerated
`nitrogen/generated/**`.

Components:

```ts
// PipelineImage and NativePipelineImage
fit?: ResizeFit;          // default: derived from `resizeMode`, else 'cover'
allowUpscale?: boolean;   // default true
```

Everything new is optional and every default reproduces 1.6.0 output → `feat:` commit, semver minor.

## 3. One geometry, three implementations

Both platforms (and the test oracle) implement this exact function. `w × h` is the decoded source,
`W × H` the box, all in pixels.

```
scale(fit, allowUpscale):
  cover   : sx = sy = max(W/w, H/h)
  contain : sx = sy = min(W/w, H/h)
  stretch : sx = W/w ; sy = H/h
  center  : sx = sy = 1
  if !allowUpscale: sx = min(sx, 1) ; sy = min(sy, 1)

scaledW = round(w · sx) ; scaledH = round(h · sy)
outW    = min(W, scaledW) ; outH = min(H, scaledH)
origin  = ((outW − scaledW) / 2, (outH − scaledH) / 2)     // centred crop when scaled > out
```

Output bitmap is `outW × outH`; the source is drawn scaled to `scaledW × scaledH` at `origin`. This
single formula yields the whole matrix, including the `allowUpscale: false` cases the gist leaves
implicit (e.g. `cover` of a 100×50 into 400×400 with no upscale → 100×50):

| Source → box | cover | contain | stretch | center |
|---|---|---|---|---|
| 2000×1000 → 400×400 | 400×400 (crop) | 400×200 | 400×400 | 400×400 (crop, no scale) |
| 100×50 → 400×400 | 400×400 (upscale) | 400×200 (upscale) | 400×400 | 100×50 |
| 100×50 → 400×400, `allowUpscale:false` | 100×50 | 100×50 | 100×50 | 100×50 |
| 200×200 → 120×80 | 120×80 | 80×80 | 120×80 | 120×80 (crop) |
| 200×200 → 300×400 | 300×400 | 300×300 | 300×400 | 200×200 |

`round` is round-half-away-from-zero on both platforms (Swift `.rounded()`, Kotlin `roundToInt()`),
which is also what Nuke's own `Resize` uses. Rounding is the one place the two could drift by a
pixel; the harness matrix pins it.

Processing order stays **resize → blur → corners**, so `blur` sigma and `cornerRadius` are in pixels
of the produced bitmap (under `contain` the corners round the image's own edges, not the box).

## 4. iOS (`ios/`)

**`HybridNitroImagePipeline.swift`**

- `processors(for:)`: when `fit == .cover && allowUpscale != false` keep the existing
  `ImageProcessors.Resize(... .aspectFill, crop: true, upscale: true)` — identifier, cache key and
  bytes unchanged. Otherwise append a new `FitResizeProcessor(width:height:fit:allowUpscale:)`.
- `makeRequest(url:options:)` thumbnail decode:
  - `cover` / `stretch`: `ThumbnailOptions(size: box, contentMode: .aspectFill)` (as today;
    covers both axes so `stretch` never upscales a subsampled decode).
  - `contain`: `.aspectFit` — the thumbnail already fits the box; `CGImageSource` never upscales,
    so `allowUpscale: false` is safe here too.
  - `center`: **no thumbnail** (a subsampled decode would crop scaled pixels).
- `resizeSize(for:)` unchanged; add `resizeFit(for:)` / `allowsUpscale(for:)` helpers so the loader
  and `loadImage` share them.

**New `ios/FitResizeProcessor.swift`** (`ImageProcessing`, modelled on `RoundedCornersProcessor`)

- `identifier`: `com.nitroimagepipeline.resize?w=…,h=…,fit=…,upscale=…` (new fits ⇒ new cache
  entries; nothing existing is invalidated).
- `process`: compute §3 from `image.size` (orientation-corrected points; the pipeline's images are
  scale 1, matching `RoundedCornersProcessor`), then `UIGraphicsImageRenderer(size: out)` with
  `format.scale = image.scale`, `preferredRange = .standard`, `opaque = false`, and
  `image.draw(in: CGRect(origin: origin, size: scaled))`. Returns `image` unchanged when
  `out == image.size` and `scaled == out` (the `center`-fits and `contain, allowUpscale:false` no-op
  cases), so no copy is made.
- Note `ImageProcessors.Resize(.aspectFit, crop: false, upscale:)` *would* do `contain` alone, but
  a single processor for all non-default fits is easier to keep byte-equal with Android than mixing
  Nuke's draw path with ours. Decide once; if Nuke's `aspectFit` is preferred for `contain`, pin
  its rounding against the Kotlin side in the harness.

**`PipelineImageLoader.swift`**

- `pixelOptions(scale:sizePx:)` builds `ResizeOptions(width:height:fit:allowUpscale:)` with
  `fit = options.resize?.fit ?? options.fit`, same for `allowUpscale`.
- `start(...)`: after the load, assign
  `UIImage(cgImage: image.cgImage!, scale: displayScale, orientation: image.imageOrientation)`
  (fallback to `image` if `cgImage` is nil) so `.center` draws 1 bitmap px per device px (see §1 #4).
  The synchronous memory-cache-hit branch does the same. The base branch's `notifyLoad` reports
  `image.size × image.scale`, so pass it the *unwrapped* Nuke image (scale 1) — or the wrapped one,
  the product is the same pixels either way — and add a harness assertion that `onLoad` still
  reports bitmap pixels after the rewrap.

## 5. Android (`android/`)

**`transform/ResizeTransformation.kt`** → `ResizeTransformation(width, height, fit, allowUpscale)`

- `cacheKey`: keep `"<class>-$width-$height"` **verbatim** for `COVER` + `allowUpscale`; append
  `-$fit` and `-noupscale` only otherwise. `equals`/`hashCode`/`toString` include the new fields.
- `transform`: §3 with a `Matrix` (`setScale(sx, sy)` + `postTranslate(origin)`), output
  `outW × outH`; early-return the input when it is already the output (as today).

**New `transform/PipelineRoundedCornersTransformation.kt`**

Coil's `RoundedCornersTransformation` scale-fills and crops to the *request* size inside its own
draw (that is why `buildRequest` skips the explicit resize for "corners, no blur"). Under any fit
other than `cover` the request size is a box, not the output size, so it would upscale a `contain`
or `center` result back to the box. Port `ios/RoundedCornersProcessor.swift` (clip path with the
same CSS-style radius clamping, drawn at the input's own size, ignoring the `size` argument) and
use it whenever the output size can differ from the box. Keep Coil's transformation for
`cover` + `allowUpscale` so those bytes and keys stay identical. Later this can replace Coil's for
per-corner radii everywhere (it also makes the clamping match iOS), but not in this PR.

**`HybridNitroImagePipeline.buildRequest`**

- Transformations: `cover`+upscale → unchanged logic. Any other fit → always add
  `ResizeTransformation`, then blur, then `PipelineRoundedCornersTransformation`.
- Request size / scale:
  - `cover` / `stretch`: `size(box)` + `Scale.FILL` (as today).
  - `contain`: `size(box)` + `Scale.FIT` + `precision(Precision.INEXACT)` — subsample only; the
    transformation makes it exact with the same rounding as iOS instead of Coil's.
  - `center`: `size(Size.ORIGINAL)`.
- `hardwareResult` / `HardwareBitmapTransformation` unchanged.

**`PipelineImageLoader.kt`**: `pixelOptions` copies `fit`/`allowUpscale` into the
`ResizeOptions` it builds from the measured size (same precedence as iOS). Android's
`ScaleType.CENTER` already draws bitmap pixels 1:1; verify on device that the decoded bitmap's
density does not rescale it in `BitmapDrawable` (Coil sets `inScaled`; if the drawable comes out
at density-scaled size, set `bitmap.density = DENSITY_NONE`-equivalent via
`imageView.setImageDrawable(BitmapDrawable(resources, bitmap).apply { setTargetDensity(...) })`).

## 6. JavaScript (`src/`)

- `useImage.ts`: destructure `resizeFit = resize?.fit` and `resizeAllowUpscale =
  resize?.allowUpscale` next to `resizeWidth`/`resizeHeight`, add both to the effect deps, and
  pass them in the rebuilt `resize` object. Update the `resize` JSDoc.
- `usePipelineImageLoader.ts`: same by-value split for `options.fit`, `options.allowUpscale`,
  `options.resize?.fit`, `options.resize?.allowUpscale`; include them in `stableOptions` (and thus
  in the `__source` tag the view diffs) and in the `useMemo` deps, next to the base branch's
  `hasOnLoad`/`hasOnError`/`notifyLoad`/`notifyError`. Unlike the callbacks, `fit` *is* part of
  "what is loaded", so two loaders that differ only in `fit` are different images.
- `PipelineImage.tsx`: destructure `resizeMode` explicitly (still forwarded to the view), add
  `fit` and `allowUpscale` props; `effectiveFit = fit ?? resizeMode` (undefined ⇒ native default
  `cover`); `resize = size && { ...size, fit: effectiveFit, allowUpscale }`. `sameSize` stays
  width/height-only (fit changes flow through `useImage`'s deps).
- `NativePipelineImage.tsx`: same two props, `usePipelineImageLoader(url, { ..., fit: fit ??
  resizeMode, allowUpscale, onLoad, onError })` — the callbacks come from the base branch.
- `resizeForStyle.ts`: JSDoc only — under `contain`/`center` the returned box is an upper bound.
- `index.ts`: export `type ResizeFit`.

## 7. Tests (`example/__tests__`, react-native-harness, run by the iOS and Android CI jobs)

No new fixtures are needed. A 2:1 source comes from the pipeline itself, the way
`local-images.harness.tsx` already does it: `loadImage(GRADIENT_URL, { resize: { width: 200,
height: 100 } })` → `saveToTemporaryFileAsync()` → load that path. The 200×200 fixtures cover the
square-source rows.

New `resize-fit.harness.ts` (+ move `rgbOf` from `local-images.harness.tsx` into a shared
`pixels.ts`):

1. **Geometry oracle**: a TS copy of §3 in `fit-geometry.ts`; every dimension assertion below is
   `expect([image.width, image.height]).toEqual(expected(...))`, so the table in §3 is what CI
   checks, on both platforms, from one source of truth.
2. **Matrix** over `{cover, contain, stretch, center} × {allowUpscale true/false}` for
   200×100→40×40, 200×200→120×80, 200×200→300×400 (covers every row of §3).
3. **`cover` unchanged**: `rgbOf(loadImage(url, { resize }))` `toEqual`
   `rgbOf(loadImage(url, { resize: { ...resize, fit: 'cover', allowUpscale: true } }))` — and,
   with a warm cache cleared in `beforeAll`, the same bytes as the existing suites' expectations.
4. **Pixels, not just sizes**: on the checkerboard, `center` must equal the exact centre region of
   the source (no resampling); `contain` of 200×200 into 120×80 is 80×80 and its corner colours
   match a plain `resize: 80×80`; `stretch` differs from `cover` on a 200×100 source.
5. **Corners under `contain`** (Android `RoundedCornersTransformation` regression): `cornerRadius`
   + `fit: 'contain'` + no blur returns `80×80`, not the box; per-corner radii likewise.
6. **Blur under non-cover fits**: size unchanged, and a `blur` result differs from the unblurred one.
7. **Loader path**: `createImageLoader(url, { fit, resize }).loadImage()` and
   `createImageLoader(url, { resize: { ..., fit } })` (precedence) produce the §3 sizes.
8. **Components**: `<PipelineImage resizeMode="contain" style={{ width: 300, height: 200 }}
   onLoad>` reports `resizeForLayout(300, 200)` bounded, aspect-fitted sizes; `fit="cover"`
   overrides `resizeMode="contain"`. `<NativePipelineImage resizeMode="contain">` and
   `resizeMode="center"` assert the produced size through the base branch's
   `onLoad(width, height)` (pixels), with an explicit `resize` so the expectation is independent
   of the device scale — the pattern its `pipeline-image-loader.harness.tsx` already uses. Note
   that `onLoad` is not one-shot there (a view can report twice for the same image), so record
   the latest size and `waitFor` it rather than counting calls.
9. Extend `resize-for-style.harness.ts` only if `resizeForLayout` gains a `fit` passthrough
   (it does not in this plan).

## 8. Docs

- README: features bullet, `loadImage` options table (`resize` row →
  `{ width, height, fit?, allowUpscale? }`), a new **Resize modes** subsection with the §3 matrix,
  `fit`/`allowUpscale` rows for both components (with the `resizeMode` inference rule),
  `createImageLoader`/`usePipelineImageLoader` paragraph (`fit` in `ViewOptions`),
  `resizeForStyle` note (upper bound under `contain`/`center`), and a **Memory usage** bullet that
  `center` decodes at full resolution.
- `CLAUDE.md` key-files table: add `ios/FitResizeProcessor.swift`,
  `android/.../transform/ResizeTransformation.kt` (now fit-aware) and
  `PipelineRoundedCornersTransformation.kt`, plus one line under the architecture notes that the
  resize geometry is a cross-platform contract like blur.
- CHANGELOG is generated by semantic-release from the `feat:` commit; do not edit it.

## 9. Order of work (one PR, reviewable commits)

1. `feat(spec): add ResizeFit and allowUpscale` — spec + `bun run codegen` output.
2. `feat(ios): fit-aware resize` — `FitResizeProcessor`, `processors`/`makeRequest`, loader
   passthrough, `center` display-scale fix.
3. `feat(android): fit-aware resize` — `ResizeTransformation`, `PipelineRoundedCornersTransformation`,
   `buildRequest` sizing, loader passthrough.
4. `feat: fit / allowUpscale on useImage, loaders and components` — §6.
5. `test: resize fit matrix` — §7.
6. `docs: resize modes` — §8.

Step 0 is `git checkout -b <branch> origin/claude/nativepipelineimage-onload-onerror-vdy7vm`. Open
the PR against that branch (GitHub retargets it to `main` automatically once the base merges), and
squash on merge into a single `feat: add fit / allowUpscale resize modes` so the release is a minor.

## 10. Verification

- Locally (any host): `bun run typecheck`, `bun run lint`, `bun run codegen` (clean diff after a
  second run), `bun run build`.
- Native: this repo has no host-side test for the resize kernel, so the harness suites in
  `.github/workflows/ios.yml` and `android.yml` are the check (they run on PRs touching `src/**`,
  `ios/**`, `android/**`, `example/__tests__/**`). `swiftlint --strict` and `ktfmt` run in the
  pre-commit hook when installed.
- Manual on device: `resizeMode="center"` on `<PipelineImage>` shows the same size on iOS and
  Android (§1 #4, §5 density note); `contain` of a logo in a wide box has no crop and no padding
  in the bitmap (`onLoad` dims) while the view letterboxes it.

## 11. Risks and open questions

- **`repeat` is out** (§1 #1). If parity with the gist's five values matters more than matching
  nitro-image, `'repeat'` can be accepted as an alias for "no resize" at zero cost; the view still
  cannot tile it. Recommend leaving it out until nitro-image supports it.
- **Full decode under `center`** on both platforms; a 48 MP source costs ~190 MB transiently.
  Documented; region decode is a follow-up.
- **Rounding drift** between `UIGraphicsImageRenderer` and `Canvas.drawBitmap` resampling means
  `contain`/`stretch` are dimension-identical across platforms but not byte-identical (same as
  `cover` today). Tests compare sizes and coarse colours, not bytes, across platforms.
- **Coil `Precision`** semantics for an explicit `size()` with no view target should be checked
  against Coil 3.3.0 when implementing §5; if `AUTOMATIC` already resolves to `INEXACT`, the
  explicit call is harmless.
- **EXIF-rotated sources**: both platforms use orientation-corrected dimensions (`UIImage.size`,
  Coil's upright bitmap), so `contain` of a portrait JPEG fits the portrait shape. Worth one
  rotated fixture if a regression ever appears; not in scope now.
- **`PipelineImage` re-layout under `contain`**: the bitmap is smaller than the box, the view's
  `resizeMode="contain"` letterboxes it — visually the same as today, at half the decoded pixels.
  A later style change re-derives `resize` through the existing `onLayout` path; nothing new.

## 12. What the base branch changes for this plan

`claude/nativepipelineimage-onload-onerror-vdy7vm` adds `onLoad(width, height)` / `onError(message)`
to `ViewOptions`, `usePipelineImageLoader` and `NativePipelineImage`, and wires them through both
native view loaders. Consequences:

- **Spec**: `ViewOptions` already gained two function-typed fields; `fit`/`allowUpscale` go next to
  them. Nitrogen's generated `ViewOptions.*`, `JViewOptions.hpp` and the Swift bridge all change on
  both branches — regenerate, never merge by hand.
- **Hook**: `usePipelineImageLoader` now splits options into primitives *and* keeps callbacks in a
  ref (updated in a `useLayoutEffect`), handing native a wrapper built by `makeReporters` that is
  gated on a per-loader token; the `useMemo` returns `{ loader, token }`. `fit`/`allowUpscale` follow the
  primitives path (they change the loader); do not put them next to the callbacks (which
  deliberately don't). The loader's `__source` tag is now `{ url, options, callbacks }` — `fit`
  and `allowUpscale` belong in `options` (via `stableOptions`), which is what makes the view swap
  loaders when the fit changes.
- **iOS loader**: `start(into:key:generation:sizePx:)` now has a `do/catch` with
  `notifyLoad(image)` in both the cache-hit and async branches, a per-view `generation` guard so
  superseded work neither displays nor reports, and reports an invalid URL through `onError`
  before anything else. The `center` display-scale rewrap (§4) lands in the two success branches,
  after the generation guard; keep `notifyLoad` reporting pixels (`size × scale`).
- **Android loader**: `onLoad` reads `bitmap.width/height` inside a `report { }` wrapper that
  swallows callback exceptions; unaffected by fit. If the density
  check in §5 needs a `BitmapDrawable`, report the bitmap's size, not the drawable's.
- **Tests**: `pipeline-image-loader.harness.tsx` now imports `useEffect`/`useState` and has an
  `onLoad` size test to copy for the fit cases (§7 #8). `NativePipelineImage` sizes are
  observable in JS now, so the fit suite needs no back door through the hook. Its own tests
  already treat `onLoad` as "may fire more than once" (they settle, then compare) — fit tests
  must do the same.
- **README**: the `<NativePipelineImage>` table has `onLoad`/`onError` rows; put `fit` and
  `allowUpscale` above them, after `resize`, and mention in the `createImageLoader` paragraph
  that `fit` (unlike the callbacks) is part of the loader's identity.
