# Auto-resize from `style` (`<PipelineImage>` + `resizeForStyle`) Orchestration Plan

**Date:** 2026-08-26 · **Branch:** `main` · **Commit:** `013633c` · **Research:** `tasks/2026-08-26-auto-resize-from-style/research.md` (commit `eee48e7`)

> Drift note: the research commit `eee48e7` is a Kotlin-formatting-only commit on the unmerged
> `chore/ktfmt-kotlin-formatting` branch. `main` at `013633c` differs from it only in Kotlin
> whitespace (untouched by this plan). All `src/`, README, example and test citations below were
> re-verified against `013633c` and refer to today's line numbers.

## Overview

Add a JS-side `<PipelineImage>` component that derives the pipeline's `resize` (bitmap pixels =
layout points × `PixelRatio.get()`) from its own `style`/`onLayout`, so callers stop duplicating
`300 * px` literals; ship the converter as `resizeForStyle()` for `useImage` users, and give
`useImage` an `enabled` flag so loading can wait for a layout size.

## Current State Analysis

- The "resize to display size" optimisation is entirely caller-driven and in pixels: `useImage`
  (`src/index.ts:43-144`) and `loadImage` take `resize: { width, height }` in **bitmap pixels**;
  neither native side applies any density factor (`ios/HybridNitroImagePipeline.swift:140-147`
  uses `unit: .pixels`; `android/.../HybridNitroImagePipeline.kt:46-51` rounds to `Int`).
- This library ships **no component and no `style` prop**. Display goes through
  `react-native-nitro-image`'s `<NitroImage>` / `NativeNitroImage`; its native view never
  downsamples to its bounds or observes layout, and the only native hook that receives the view
  (`ImageLoader.requestImage(forView:)`) is not implemented here. A native solution would need a
  new HybridObject + codegen and still could not observe layout — so the automatic path is JS.
- `useImage` fires `loadImage` in its mount effect (`src/index.ts:91`), before any `onLayout`
  could report a size, and has no way to defer.
- `src/` is a single file: `src/index.ts` creates the hybrid object (`:15-16`) and defines
  `useImage` (`:43-144`). `import/no-cycle` is an **error** in `.oxlintrc.json:23`, so a new
  component file cannot import `useImage` from `./index` while `index.ts` re-exports the component.
- `tsconfig.json:8` has `"jsx": "react"` (classic runtime → would require `import React` in every
  `.tsx`). Compiled output goes through `@react-native/babel-preset`, which uses the automatic JSX
  runtime (`node_modules/@react-native/babel-preset/src/configs/main.js:83`), and the example app
  / RN template use `"jsx": "react-native"` — no `React` import needed.
- Tests are on-device `react-native-harness` suites in `example/__tests__/*.harness.ts(x)`
  (run with `cd example && bun run test:harness:ios` / `test:harness:android`; CI in
  `.github/workflows/harness-tests.yml`). The pre-commit hook runs `oxlint --deny-warnings` on
  staged files (`lefthook.yml:26-34`), so `react-native/no-inline-styles` **warnings block
  commits** — tests must use `StyleSheet.create`.
- The example app duplicates `300`/`200` in `styles.image` (points, `example/App.tsx:59-62`) and
  in `resize: { width: 300 * px, … }` (`:24`, `:72`).
- `README.md:63` renders `<NitroImage source={image} />`, but nitro-image's prop is `image`
  (`node_modules/react-native-nitro-image/src/NitroImage.tsx:12`) — a doc typo.

## Desired End State

- `import { PipelineImage, resizeForStyle, resizeForLayout, useImage, NitroImagePipeline } from
  'react-native-nitro-image-pipeline'` all resolve; the existing public API is unchanged.
- `<PipelineImage url style={{ width: 300, height: 200 }} cornerRadius={24} />` loads a bitmap of
  exactly `PixelRatio.getPixelSizeForLayoutSize(300) × …(200)` pixels with 24 pt corners, with no
  caller-side pixel math. With `style={{ width: '50%', aspectRatio: 2 }}` it waits for the
  view's first `onLayout`, then loads at the measured size × scale. It never requests the
  full-size image first.
- `useImage({ url, enabled: false })` makes no request and stays in the loading state until
  `enabled` becomes `true`.
- `resizeForStyle(styles.image)` returns `{ width, height }` in integer bitmap pixels for numeric
  styles and `undefined` otherwise.
- Verified by: `bun run typecheck`, `bun run lint`, `bun run build`, and the new harness suites
  `example/__tests__/pipeline-image.harness.tsx` and `example/__tests__/resize-for-style.harness.ts`
  passing on the iOS simulator.

Key Discoveries:
- `PixelRatio.getPixelSizeForLayoutSize(dp)` is `Math.round(dp * PixelRatio.get())`
  (`node_modules/react-native/Libraries/Utilities/PixelRatio.js:108-110`) — integer output resolves
  the research's fractional-size / per-platform-rounding open question.
- `StyleSheet.flatten<T>(style?: StyleProp<T>): T` (`node_modules/react-native/Libraries/StyleSheet/StyleSheet.d.ts:64-66`)
  handles arrays, `null`, `undefined` and registered styles.
- `NativeNitroImage` is exported by `react-native-nitro-image` (`src/index.ts:5`) with
  `image?: Image | ImageLoader` **optional** (`src/specs/ImageView.nitro.ts:33`) and `style` /
  `onLayout` via RN `ViewProps` (`react-native-nitro-modules/src/views/getHostComponent.ts:95-103`).
  `<NitroImage>` by contrast requires `image` (`src/NitroImage.tsx:11-13`) — so the component
  renders `NativeNitroImage` directly, which lets the view lay out before an image exists.
- nitro-image derives the host component's prop type with
  `type ReactProps<T> = T extends HostComponent<infer P> ? P : never` (`src/NitroImage.tsx:8-9`);
  mirror it.
- `useImage` keeps showing the current image across same-URL option changes (`src/index.ts:93-99`),
  so a layout change (rotation) swaps variants without flashing.
- Example typecheck (`cd example && bunx tsc --noEmit`) fails today on an unrelated TS 7 error
  (`baseUrl` removed) — do **not** use it as a verification command.

## What We're NOT Doing

- No native changes: no `ImageLoader` HybridObject, no `bun run codegen`, no Swift/Kotlin edits,
  no change to the pixel-based `loadImage`/`useImage` `resize`/`cornerRadius`/`blur` contract.
- Not deriving `cornerRadius` from `style.borderRadius*` — it stays an explicit prop (in points on
  the component).
- Not investigating Nuke decode-time downsampling or Coil's subsampling precision (research open
  questions 1–2) — orthogonal to the JS change.
- Not sizing `preLoadImage`/`preLoadImages` (they remain unsized prefetches).
- Not fixing the example app's broken `tsc` config (`baseUrl`) or the CLAUDE.md
  `bun run codegen` description mismatch (research open question 6).
- Not touching the pre-existing uncommitted example changes (`example/ios/**`,
  `example/package.json`, `example/ios/Podfile.lock`, `SceneDelegate.swift`) beyond the specific
  `example/App.tsx` edits in Phase 3; never stage those files.
- Not adding jest unit tests — the repo's test runner is `react-native-harness` on device.

## Implementation Approach

Split `src/index.ts` into small modules so the component can import `useImage` without an import
cycle: `NitroImagePipeline.ts` (hybrid object), `useImage.ts` (hook, gains `enabled`),
`resizeForStyle.ts` (pure helpers), `PipelineImage.tsx` (component), and `index.ts` (re-exports
only). Switch `tsconfig.json` to `"jsx": "react-native"` to match the example/RN template and the
automatic runtime bob actually compiles with. The component computes `resize` as
`resizeForStyle(style) ?? layoutSize` — a numeric style starts the request immediately, otherwise
the first `onLayout` does — and passes `enabled: resize !== undefined` so the full-size image is
never fetched. Its `blur`/`cornerRadius` are in **points** and multiplied by `PixelRatio.get()`
(user decision: the component speaks points like `style` does). Tests assert exact pixel output
through a new `onLoad(image)` callback.

## Orchestration

**Orchestrator model:** `sonnet` — balanced tier; phases are fully specified with code, the
orchestrator only briefs, verifies diffs, and re-runs checks. This line is static.

**Commit convention:** one commit per phase on a new branch `feat/pipeline-image` created from
`main` (`git switch -c feat/pipeline-image` before Phase 1). Conventional-commit messages, since
semantic-release reads them: Phase 1 → `feat: add PipelineImage component and resizeForStyle
helper`, Phase 2 → `test: cover PipelineImage and resizeForStyle in harness suites`, Phase 3 →
`docs: document PipelineImage and drop pixel math from the example`. Stage **only** the files each
phase lists (`git add <paths>`, never `git add -A`); the working tree already holds unrelated,
uncommitted example-app changes that must stay unstaged. Commit with lefthook active (it formats
and lints staged files); `LEFTHOOK=0` only if a hook needs a missing brew tool.

---

## Phase 1: Core — module split, `useImage.enabled`, `resizeForStyle`, `<PipelineImage>`

### Overview
Restructures `src/` into cycle-free modules, adds the `enabled` flag to `useImage`, the pure
size helpers, and the component. Comes first because everything else (tests, docs) depends on
these exports existing.

### Recommended model
`sonnet` — well-specified implementation with complete code below; needs care around hook deps
and TS strictness, not architectural judgment.

### Effort
high — hook dependency arrays are lint errors, `noImplicitReturns`/`verbatimModuleSyntax` are on,
and the layout/enabled interplay has edge cases (see the notes in the code).

### Changes Required

#### 1. JSX runtime
**File**: `tsconfig.json`
**Changes**:
- [x] In `compilerOptions`, change the `"jsx"` entry at line 8 from `"jsx": "react",` to
  `"jsx": "react-native",` (same value as `@react-native/typescript-config`; bob compiles via
  `@react-native/babel-preset`'s automatic runtime, so no `import React` is needed in `.tsx`).

#### 2. Hybrid object module
**File**: `src/NitroImagePipeline.ts` (new)
**Changes**:
- [x] Create the file with exactly:
  ```ts
  import { NitroModules } from 'react-native-nitro-modules';

  import type { NitroImagePipeline as NitroImagePipelineSpec } from './specs/nitro-image-toolkit.nitro';

  export const NitroImagePipeline =
    NitroModules.createHybridObject<NitroImagePipelineSpec>('NitroImagePipeline');
  ```

#### 3. Hook module with `enabled`
**File**: `src/useImage.ts` (new)
**Changes**:
- [x] Move the `Result` type (`src/index.ts:18-33`), the `useImage` doc comment (`:35-42`) and the
  `useImage` function (`:43-144`) into this file verbatim, with these imports at the top:
  ```ts
  import { useEffect, useRef, useState } from 'react';
  import type { Image } from 'react-native-nitro-image';

  import { NitroImagePipeline } from './NitroImagePipeline';
  import type {
    CacheOption,
    CornerRadii,
    ResizeOptions,
  } from './specs/nitro-image-toolkit.nitro';
  ```
- [x] Add the `enabled` option: in the destructured parameter list (`useImage({ url, blur = 0,
  cornerRadius = 0, resize, cache })`) add `enabled = true,` after `cache,`; in the options type
  add, after `cache?: CacheOption;`:
  ```ts
    /**
     * When `false`, no request is made and the result stays in the loading
     * state (or keeps the current image if `url` is unchanged) until it becomes
     * `true`. Use it to defer loading until inputs such as a layout size are
     * known.
     * @default true
     */
    enabled?: boolean;
  ```
- [x] In the effect (currently `useEffect(() => { let cancelled = false; … })`), wrap the async
  IIFE in `if (enabled) { … }` so the URL-reset block still runs when disabled and the cleanup is
  always returned (do **not** early-return — `noImplicitReturns` is on):
  ```ts
    if (loadedUrlRef.current !== url) {
      loadedUrlRef.current = url;
      setImage({ image: undefined, error: undefined });
    }

    if (enabled) {
      (async () => {
        try {
          const result = await NitroImagePipeline.loadImage(url, {
            /* unchanged */
          });
          if (!cancelled) {
            setImage({ image: result, error: undefined });
          }
        } catch (e) {
          /* unchanged */
        }
      })();
    }

    return () => {
      cancelled = true;
    };
  ```
- [x] Append `enabled,` to the effect's dependency array (after `cache,`) — `react/exhaustive-deps`
  is an error.

#### 4. Pure size helpers
**File**: `src/resizeForStyle.ts` (new)
**Changes**:
- [x] Create the file with exactly:
  ```ts
  import {
    PixelRatio,
    type StyleProp,
    StyleSheet,
    type ViewStyle,
  } from 'react-native';

  import type { ResizeOptions } from './specs/nitro-image-toolkit.nitro';

  /**
   * Converts a layout size in points (dp) to the pipeline's `resize` option in
   * whole bitmap pixels using `PixelRatio.getPixelSizeForLayoutSize`. Returns
   * `undefined` unless both values are positive numbers.
   */
  export function resizeForLayout(
    width: unknown,
    height: unknown,
  ): ResizeOptions | undefined {
    if (typeof width !== 'number' || typeof height !== 'number') {
      return undefined;
    }
    const pixelWidth = PixelRatio.getPixelSizeForLayoutSize(width);
    const pixelHeight = PixelRatio.getPixelSizeForLayoutSize(height);
    return pixelWidth > 0 && pixelHeight > 0
      ? { width: pixelWidth, height: pixelHeight }
      : undefined;
  }

  /**
   * Derives the pipeline's `resize` option from a view style whose `width` and
   * `height` are numeric points, so the bitmap matches the display size on
   * every screen density:
   * ```ts
   * useImage({ url, resize: resizeForStyle(styles.image) });
   * ```
   * Arrays and registered styles are flattened. Returns `undefined` when either
   * dimension is missing or not a number (`'50%'`, `'auto'`, flex-driven) —
   * use `<PipelineImage>` for those, which measures the view instead.
   */
  export function resizeForStyle(
    style: StyleProp<ViewStyle>,
  ): ResizeOptions | undefined {
    const flat = StyleSheet.flatten(style);
    return resizeForLayout(flat?.width, flat?.height);
  }
  ```

#### 5. The component
**File**: `src/PipelineImage.tsx` (new)
**Changes**:
- [x] Create the file with exactly:
  ```tsx
  import { useEffect, useRef, useState } from 'react';
  import {
    type HostComponent,
    type LayoutChangeEvent,
    PixelRatio,
  } from 'react-native';
  import { type Image, NativeNitroImage } from 'react-native-nitro-image';

  import { resizeForLayout, resizeForStyle } from './resizeForStyle';
  import type {
    CacheOption,
    CornerRadii,
    ResizeOptions,
  } from './specs/nitro-image-toolkit.nitro';
  import { useImage } from './useImage';

  type ReactProps<T> = T extends HostComponent<infer P> ? P : never;
  type NativeImageProps = ReactProps<typeof NativeNitroImage>;

  export interface PipelineImageProps extends Omit<NativeImageProps, 'image'> {
    /** URL of the image to load through the pipeline. */
    url: string;
    /**
     * Gaussian blur sigma in **points** (density-independent). Unlike
     * `useImage`/`loadImage`, where it is bitmap pixels, the component
     * multiplies it by `PixelRatio.get()` so the same value looks the same on
     * every device.
     * @default 0
     */
    blur?: number;
    /**
     * Corner radius in **points**, like `style.borderRadius` — a single number
     * or per-corner radii. Converted to bitmap pixels with `PixelRatio.get()`
     * and baked into the bitmap at the display size.
     * @default 0
     */
    cornerRadius?: number | CornerRadii;
    cache?: CacheOption;
    /** Called with the processed `Image` each time a new variant resolves. */
    onLoad?: (image: Image) => void;
    /** Called when loading fails. */
    onError?: (error: Error) => void;
  }

  function sameSize(a?: ResizeOptions, b?: ResizeOptions): boolean {
    return a?.width === b?.width && a?.height === b?.height;
  }

  function scaleRadius(
    cornerRadius: number | CornerRadii,
    scale: number,
  ): number | CornerRadii {
    if (typeof cornerRadius === 'number') {
      return cornerRadius * scale;
    }
    return {
      topLeft: (cornerRadius.topLeft ?? 0) * scale,
      topRight: (cornerRadius.topRight ?? 0) * scale,
      bottomLeft: (cornerRadius.bottomLeft ?? 0) * scale,
      bottomRight: (cornerRadius.bottomRight ?? 0) * scale,
    };
  }

  /**
   * A `NativeNitroImage` that loads `url` through the pipeline at exactly the
   * size it is displayed: the bitmap is resized to the view's size in points ×
   * `PixelRatio.get()`, so `blur` and `cornerRadius` (both in points here) apply
   * 1:1 to what is on screen and large sources are never decoded at full size.
   *
   * A numeric `width`/`height` in `style` starts loading immediately; otherwise
   * (`'50%'`, `flex`, `aspectRatio`, …) loading waits for the first `onLayout`.
   * If the layout size later changes, a new variant is loaded and swapped in
   * without flashing.
   * @example
   * ```tsx
   * <PipelineImage
   *   url="https://example.com/photo.jpg"
   *   style={{ width: 300, height: 200 }}
   *   cornerRadius={24}
   * />
   * ```
   */
  export function PipelineImage({
    url,
    blur = 0,
    cornerRadius = 0,
    cache,
    onLoad,
    onError,
    style,
    onLayout,
    ...viewProps
  }: PipelineImageProps) {
    const scale = PixelRatio.get();
    const styleSize = resizeForStyle(style);
    const [layoutSize, setLayoutSize] = useState<ResizeOptions | undefined>(
      undefined,
    );
    // A numeric style is what the caller declared, so it wins and starts the
    // request a frame earlier; the measured layout is the fallback.
    const resize = styleSize ?? layoutSize;

    const { image, error } = useImage({
      url,
      blur: blur * scale,
      cornerRadius: scaleRadius(cornerRadius, scale),
      cache,
      resize,
      enabled: resize !== undefined,
    });

    // Latest callbacks in refs so inline arrow props don't re-fire the effects.
    const onLoadRef = useRef(onLoad);
    const onErrorRef = useRef(onError);
    useEffect(() => {
      onLoadRef.current = onLoad;
      onErrorRef.current = onError;
    });
    useEffect(() => {
      if (image) onLoadRef.current?.(image);
    }, [image]);
    useEffect(() => {
      if (error) onErrorRef.current?.(error);
    }, [error]);

    const handleLayout = (event: LayoutChangeEvent) => {
      onLayout?.(event);
      const { width, height } = event.nativeEvent.layout;
      const next = resizeForLayout(width, height);
      // Always record it (even when a numeric style is in charge) so a later
      // switch to a non-numeric style has a size to fall back on.
      setLayoutSize((prev) => (sameSize(prev, next) ? prev : next));
    };

    return (
      <NativeNitroImage
        {...viewProps}
        style={style}
        onLayout={handleLayout}
        image={image}
      />
    );
  }
  ```
  Notes for the implementer: `onLayout` comes from RN `ViewProps` on `NativeImageProps`; if
  `useState<ResizeOptions | undefined>(undefined)` trips a lint rule, `useState<ResizeOptions>()`
  is equivalent. Do not add a `React` import — the JSX runtime is automatic after change #1.

#### 6. Entry point becomes re-exports only
**File**: `src/index.ts`
**Changes**:
- [x] Replace the entire file (currently the import block at `:1-11`, `NitroImagePipeline` at
  `:15-16`, `Result` at `:18-33`, `useImage` at `:43-144`) with exactly:
  ```ts
  export { NitroImagePipeline } from './NitroImagePipeline';
  export { PipelineImage, type PipelineImageProps } from './PipelineImage';
  export { resizeForLayout, resizeForStyle } from './resizeForStyle';
  export type {
    CacheOption,
    CornerRadii,
    Options,
    ResizeOptions,
  } from './specs/nitro-image-toolkit.nitro';
  export { useImage } from './useImage';
  ```
  (`oxfmt` has `sortImports: true`; let `bun run lint:fix` settle ordering.)

### Success Criteria

#### Automated Verification:
- [x] Type checking passes: `bun run typecheck`
- [x] Lint + format pass: `bun run lint` (run `bun run lint:fix` first to apply formatting)
- [x] No warnings on the new/changed files: `bunx oxlint --deny-warnings src tsconfig.json`
- [x] Build succeeds: `bun run build` — and `lib/typescript/src/index.d.ts` exports
  `PipelineImage`, `PipelineImageProps`, `resizeForStyle`, `resizeForLayout`, `useImage`,
  `NitroImagePipeline` (`grep -E "PipelineImage|resizeForStyle|useImage" lib/typescript/src/index.d.ts`)
- [x] Existing harness suites still pass: `cd example && bun run test:harness:ios` (requires the
  `iPhone 17` / iOS 26.4 simulator from `example/rn-harness.config.mjs:24-28` and Pods installed
  via `cd example && bun run pod`)
  > Deviation: this command aborts in this sandbox during harness bootstrap
  > (`DOMException [AbortError]` in `@react-native-harness/bundler-metro`'s Metro health-check,
  > before any test runs) regardless of Phase 1's changes — confirmed by stashing all of Phase 1's
  > `src/`/`tsconfig.json` edits and reproducing the identical failure on the unmodified baseline.
  > Environment/tooling issue (Metro/harness bootstrap or simulator networking in this sandbox),
  > not a regression from this phase.

#### Manual Verification:
- [ ] In the example app, temporarily render `<PipelineImage url="https://picsum.photos/id/3/5000/3333" style={styles.image} cornerRadius={24} />`
  and confirm the corners look 24 pt on screen (same as the existing `useImage` card with
  `24 * px`).

---

## Phase 2: On-device harness tests

### Overview
Adds harness suites that pin the observable contract: exact pixel output for numeric styles,
layout-driven output for percentage styles, `onLayout` pass-through, `useImage({ enabled })`
deferral, and the pure helper's edge cases. Runs after Phase 1 because it imports its exports.

### Recommended model
`sonnet` — mirrors existing test patterns; the only subtlety is deterministic layout sizes.

### Effort
medium — mostly pattern-following, with attention to lint (`--deny-warnings`) and timing.

### Depends on prior phases
- `src/PipelineImage.tsx` exports `PipelineImage` with props `url`, `blur`, `cornerRadius`,
  `cache`, `onLoad(image)`, `onError(error)`, plus `style`/`onLayout`/`testID` from `ViewProps`.
- `src/resizeForStyle.ts` exports `resizeForStyle(style)` and `resizeForLayout(width, height)`,
  both returning `ResizeOptions | undefined` in whole pixels via
  `PixelRatio.getPixelSizeForLayoutSize`.
- `src/useImage.ts` exports `useImage` accepting `enabled?: boolean` (default `true`).
- `src/index.ts` re-exports all of the above; `example/babel.config.js` aliases
  `react-native-nitro-image-pipeline` → `../src`, so tests import from the package name.

### Changes Required

#### 1. Component suite
**File**: `example/__tests__/pipeline-image.harness.tsx` (new)
**Changes**:
- [x] Create the suite, following `example/__tests__/use-image.harness.tsx` (imports `screen`
  from `@react-native-harness/ui`; `describe/expect/it/render/waitFor` from
  `react-native-harness`; `await render(<… />)` then `await waitFor(() => expect(…))`). All
  styles via `StyleSheet.create` — `react-native/no-inline-styles` warnings fail the pre-commit
  hook. Structure:
  ```tsx
  import { screen } from '@react-native-harness/ui';
  import { useEffect, useState } from 'react';
  import { PixelRatio, StyleSheet, Text, View } from 'react-native';
  import type { Image } from 'react-native-nitro-image';
  import { describe, expect, it, render, waitFor } from 'react-native-harness';
  import { PipelineImage, useImage } from 'react-native-nitro-image-pipeline';

  const VALID_URL = 'https://picsum.photos/id/3/200/200';
  const px = (points: number) => PixelRatio.getPixelSizeForLayoutSize(points);

  const styles = StyleSheet.create({
    fixed: { width: 100, height: 50 },
    container: { width: 200 },
    half: { width: '50%', aspectRatio: 2 },
  });
  ```
- [x] `it('resizes to the numeric style size in pixels')`: render
  `<PipelineImage url={VALID_URL} style={styles.fixed} onLoad={(img) => { loaded = img; }} />`,
  `waitFor` `loaded` defined, then `expect(loaded.width).toBe(px(100))` and
  `expect(loaded.height).toBe(px(50))`.
- [x] `it('waits for layout and resizes to the measured size')`: render
  `<View style={styles.container}><PipelineImage url={VALID_URL} style={styles.half} onLoad=… /></View>`
  → layout is 100 × 50 pt → expect `px(100)` × `px(50)`.
- [x] `it('calls the caller's onLayout too')`: pass `onLayout={() => { layouts += 1; }}` with
  `styles.fixed`; `waitFor(() => expect(layouts).toBeGreaterThan(0))`.
- [x] `it('bakes cornerRadius in points into the resized bitmap')`: `style={styles.fixed}
  cornerRadius={12}` → still `px(100)` × `px(50)` (size unaffected; no throw).
- [x] `it('reports errors through onError')`: `url="https://not-real.invalid/x.jpg"` with
  `onError={(e) => { err = e; }}` → `waitFor` `err` defined.

#### 2. `useImage({ enabled })` cases
**File**: `example/__tests__/use-image.harness.tsx`
**Changes**:
- [x] Extend `TestComponent` (`:8-13`) to accept `enabled?: boolean` and pass it through:
  `useImage({ url, enabled })`.
- [x] Add `it('does not load while enabled is false')` inside `describe('useImage hook')`
  (`:15`): render `<TestComponent url={VALID_URL} enabled={false} />`, wait ~1500 ms
  (`await new Promise((r) => setTimeout(r, 1500))`), then
  `expect(screen.queryByTestId('loading')).toBeDefined()` and
  `expect(screen.queryByTestId('loaded')).toBeNull()`.
- [x] Add `it('loads once enabled flips to true')`: a small wrapper component that starts with
  `useState(false)` and flips to `true` in a `useEffect` after `setTimeout(…, 300)`, renders
  `<TestComponent url={VALID_URL} enabled={enabled} />`; `waitFor` `loaded`.

#### 3. Helper suite
**File**: `example/__tests__/resize-for-style.harness.ts` (new)
**Changes**:
- [x] Create a `describe('resizeForStyle')` with `expect/it` from `react-native-harness` and
  `PixelRatio`/`StyleSheet` from `react-native`, using a `StyleSheet.create` block, covering:
  numeric style → `{ width: px(300), height: px(200) }`; array style
  `[styles.base, styles.override]` → override wins; `'50%'` width → `undefined`; missing
  `height` → `undefined`; `undefined` style → `undefined`; `{ width: 0, height: 10 }` →
  `undefined`; `resizeForLayout(33.33, 10.5)` → both values are integers
  (`Number.isInteger`).

### Success Criteria

#### Automated Verification:
- [x] Lint passes with warnings denied: `bunx oxlint --deny-warnings example/__tests__`
- [x] Format passes: `bun run lint`
  > Deviation: `bun run lint` reports a formatting issue in `example/App.tsx`, which is the
  > pre-existing, out-of-scope uncommitted change noted in the plan's "What We're NOT Doing" —
  > confirmed unrelated by running `bunx oxfmt --check example/__tests__` alone, which passes
  > cleanly on all Phase 2 test files.
- [x] Harness suites pass on iOS: `cd example && bun run test:harness:ios` (all three suites:
  `nitro-image-pipeline`, `use-image`, `pipeline-image`, `resize-for-style`)
  > Deviation: same sandbox Metro/harness bootstrap abort (`DOMException [AbortError]`) as Phase 1
  > — reproduced independently by the orchestrator, unrelated to these changes.
- [x] Root checks still pass: `bun run typecheck`

#### Manual Verification:
- [ ] Optionally run `cd example && bun run test:harness:android` on an emulator matching
  `example/rn-harness.config.mjs:20-23` (`Medium_Phone_API_36.1`) — CI runs it on PR.

---

## Phase 3: Docs and example app

### Overview
Documents the new surface and removes the duplicated pixel math from the example, so the README's
first snippet shows the automatic path. Last because it describes finished, tested behaviour.

### Recommended model
`sonnet` — prose quality matters in the README; no logic.

### Effort
low — mechanical doc/example edits with the API fixed by Phases 1–2.

### Depends on prior phases
- `react-native-nitro-image-pipeline` exports `PipelineImage` (props: `url`, `blur` and
  `cornerRadius` in **points**, `cache`, `onLoad`, `onError`, plus `style`/`onLayout`),
  `resizeForStyle(style)`, `resizeForLayout(width, height)`, and `useImage` with an
  `enabled?: boolean` option.
- `src/` now contains `index.ts`, `NitroImagePipeline.ts`, `useImage.ts`, `resizeForStyle.ts`,
  `PipelineImage.tsx`, `specs/nitro-image-toolkit.nitro.ts`.

### Changes Required

#### 1. README
**File**: `README.md`
**Changes**:
- [ ] Insert a new `### \`<PipelineImage>\` component` subsection under `## Usage` (`:39`),
  **before** the existing `### \`useImage\` hook` (`:41`), showing the zero-math version:
  ```tsx
  import { PipelineImage } from 'react-native-nitro-image-pipeline';

  function MyComponent() {
    return (
      <PipelineImage
        url="https://example.com/photo.jpg"
        style={styles.photo} // bitmap is sized to this layout × PixelRatio.get()
        blur={2} // points, like style
        cornerRadius={12} // points, like style.borderRadius
      />
    );
  }

  const styles = StyleSheet.create({ photo: { width: 300, height: 200 } });
  ```
  followed by two or three sentences: numeric `width`/`height` load immediately; percentage/flex
  sizes wait for the first `onLayout`; the full-size image is never fetched; `blur`/`cornerRadius`
  are in points **on the component only**; `onLoad`/`onError` callbacks; every other prop
  (`resizeMode`, `recyclingKey`, `testID`, …) is passed to `NativeNitroImage`.
- [ ] In the `useImage` snippet (`:45-65`): replace `const px = PixelRatio.get();` (`:49`) and
  `resize: { width: 300 * px, height: 200 * px },` (`:55`) with
  `resize: resizeForStyle(styles.image), // display size × PixelRatio.get()`; change
  `cornerRadius: 12 * px,` (`:56`) to `cornerRadius: 12 * PixelRatio.get(), // bitmap pixels`;
  add `resizeForStyle` to the import at `:46`; fix `<NitroImage source={image} />` (`:63`) to
  `<NitroImage image={image} style={styles.image} />`; add a `styles` block with
  `image: { width: 300, height: 200 }` below the component so `styles.image` resolves.
- [ ] In `## API Reference` add, after the `loadImage` table (`:111-116`) and before
  `### \`preLoadImage(url)\`` (`:118`), a `### \`<PipelineImage>\`` props table (`url`, `style`,
  `blur` (pt), `cornerRadius` (pt), `cache`, `onLoad`, `onError`, `onLayout`, `…NativeNitroImage
  props`) and a `### \`resizeForStyle(style)\` / \`resizeForLayout(width, height)\`` entry
  ("returns `{ width, height }` in whole pixels via `PixelRatio.getPixelSizeForLayoutSize`, or
  `undefined` for non-numeric sizes").
- [ ] Document `enabled` for `useImage` — one line in the hook section: "`enabled: false` defers
  the request (used internally by `<PipelineImage>` to wait for layout)".

#### 2. Example app
**File**: `example/App.tsx`
**Changes**:
- [ ] Replace the `useImage(...)` call (`const image = useImage({ … })` at `:21-32`) and its
  render (`{image.image && <NitroImage image={image.image} style={styles.image} />}` at `:39`)
  with the component:
  ```tsx
  <PipelineImage
    url="https://picsum.photos/id/3/5000/3333"
    blur={blur}
    style={styles.image}
    // "Ticket" shape, in points — the component sizes the bitmap to the layout
    cornerRadius={{ topLeft: 24, topRight: 24, bottomLeft: 80, bottomRight: 80 }}
  />
  ```
  Import `PipelineImage` and `resizeForStyle` from `'react-native-nitro-image-pipeline'`
  (`:5-8`); drop `useImage` from that import if no longer used.
- [ ] In the direct `NitroImagePipeline.loadImage` call (`:66-80`) replace
  `resize: { width: 300 * px, height: 200 * px },` (`:72`) with
  `resize: resizeForStyle(styles.image),` and keep the per-corner `* px` radii (this call is the
  pixel API). Update the comment at `:10-14` to say `px` is only needed for the pixel-based
  direct API now. Keep `const px = PixelRatio.get();` (`:14`) since the direct call still uses
  it.
- [ ] Confirm `styles.image` (`:59-62`) is still referenced (the `react-native/no-unused-styles`
  rule is an error) and `NitroImage` is still imported for the `image2` render (`:40`).

#### 3. CLAUDE.md key files
**File**: `CLAUDE.md`
**Changes**:
- [ ] In the `### Key Files` table, change the `src/index.ts` row (`:79`) to
  "Library entry point — re-exports only" and add rows directly after it for
  `src/NitroImagePipeline.ts` (creates the HybridObject), `src/useImage.ts` (hook; `enabled`
  defers loading), `src/resizeForStyle.ts` (points → bitmap-pixel `resize` helpers), and
  `src/PipelineImage.tsx` (`NativeNitroImage` wrapper that derives `resize` from `style`/`onLayout`;
  its `blur`/`cornerRadius` are in points).

### Success Criteria

#### Automated Verification:
- [ ] Lint + format pass on the example: `bunx oxlint --deny-warnings example/App.tsx && bunx oxfmt --check example/App.tsx`
- [ ] Root checks pass: `bun run lint && bun run typecheck`
- [ ] Harness suites still pass: `cd example && bun run test:harness:ios`

#### Manual Verification:
- [ ] `cd example && bun run ios`: the top card (now `<PipelineImage>`) renders the ticket shape
  with 24 pt / 80 pt corners, identical to before; tapping "hello" increases blur without the
  image flashing empty.
- [ ] README snippets copy-paste cleanly (imports present, prop names match nitro-image's `image`).

---

## Testing Strategy

### Unit Tests
- Test file: `example/__tests__/resize-for-style.harness.ts` (runs on device; the repo has no
  jest unit runner)
- What to test: `resizeForStyle` numeric/array/percentage/missing/undefined inputs;
  `resizeForLayout` integer output for fractional points.
- Key edge cases: zero dimensions → `undefined`; array override order; non-integer ratio devices
  (`33.33 × 2.625`) still yield integers.

### Integration Tests
- `example/__tests__/pipeline-image.harness.tsx`: numeric style → exact pixels; `'50%'` +
  `aspectRatio` inside a fixed-width container → measured pixels; `onLayout` chaining; `onError`.
- `example/__tests__/use-image.harness.tsx`: `enabled: false` never loads; flipping to `true`
  loads.

### Manual Testing Steps
1. `cd example && bun run pod && bun run ios`; confirm the ticket-shaped card looks unchanged.
2. Tap "hello" a few times: blur increases, no flash to empty between variants.
3. Rotate the simulator (⌘←) with a percentage-width `<PipelineImage>` (temporarily edit the
   example) and confirm a new variant loads at the new size without flashing.

## Performance Considerations
- Numeric styles start the request on first render (no extra frame); percentage/flex styles cost
  one layout pass before the request starts, and never fetch the full-size bitmap first.
- Each distinct pixel size is a distinct native cache entry (Nuke processor identity /
  `ResizeTransformation.cacheKey`); integer rounding via `getPixelSizeForLayoutSize` keeps keys
  stable across renders and identical on both platforms.
- The extra `setLayoutSize` on first layout in the numeric-style path is a single no-op-for-deps
  re-render (`resize` still comes from the style), so it does not trigger a reload.

## Rollback Strategy
Each phase is one commit on `feat/pipeline-image`; `git revert <sha>` per phase. Phase 1's module
split keeps the public API identical, so reverting Phases 2–3 alone leaves a working library.

## References
- Research: `tasks/2026-08-26-auto-resize-from-style/research.md` (commit `eee48e7` at time of
  planning; `main` at `013633c`)
- nitro-image host component: `node_modules/react-native-nitro-image/src/NativeNitroImage.tsx:18-21`,
  props `src/specs/ImageView.nitro.ts:18-58`
- RN: `Libraries/Utilities/PixelRatio.js:108-110`, `Libraries/StyleSheet/StyleSheet.d.ts:64-66`
- Harness config: `example/rn-harness.config.mjs`, CI `.github/workflows/harness-tests.yml`
