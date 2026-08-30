# Architecture

This document defines the current state of the generator. Read it before you change `web/src/services/labelGenerator.ts`, add a profile, move a content box, or touch the CSG carve.

The user-facing guide is [README.md](README.md).

## Terms

These words have one meaning each in this document and in the code. Do not substitute synonyms.

| Term | Meaning |
|------|---------|
| **pipeline** | The path from `LabelInput` to a downloaded `.3mf`. |
| **profile** | One `BaseStlProfileEntry` in `web/src/services/profiles.tsx`. |
| **base** | The label body geometry, loaded from a `.stl` in `web/public/`. |
| **inlay** | The merged text and icon geometry that prints in the second colour. |
| **content box** | A profile's `iconBox`, `line1Box` or `line2Box`, in millimetres. |
| **nudge** | A `{ dx, dy, scale }` delta from `web/src/services/placement.ts`. |
| **renderer** | One of the three consumers of a content box: the 3D generator, the 2D preview, the PNG exporter. |
| **chunk** | A code-split JavaScript bundle emitted by Vite. |
| **self-check** | An `assert`-based script run by `npm run check`. |
| **test** | A Vitest case in `web/tests/`, run by `npm test`. |

## Assumptions and defaults

State these before you change behaviour. Each one is load-bearing somewhere downstream.

- The generator runs in the browser. There is no server and nothing fetches an API.
- One `buildLabelMeshes` call runs at a time. The function keeps per-call state in module variables.
- `DEFAULT_PROFILE_ID` is `"cullenect"`. Anything that names the default must read that constant.
- The default emboss mode is `"raised"`. `App.tsx` initialises `embossMode` to `"raised"`.
- The default nudge is `DEFAULT_PLACEMENTS`, which is `{ dx: 0, dy: 0, scale: 1 }` per element.
- Both shipped base STLs are 2-manifold. Flush mode requires this.
- Node 22.6 or later strips TypeScript types natively. The two self-checks depend on it.

## Repository layout

```
web/                       React + Vite front end — the only deployed artifact
  src/
    App.tsx                Owns baseProfileId, embossMode, placement; builds file names
    components/
      LabelForm.tsx        Design panel: text lines, symbol picker, line-2 picker, width, downloads
      LabelPreview.tsx     Live 2D SVG preview
      SizeBatch.tsx        Fastener Sizes panel: one button per diameter, 15 lengths per press
    services/
      api.ts               Export orchestration: downloadSingle/downloadBatch/…Png
      labelGenerator.ts    Profile-driven mesh builder (text and SVG to geometry, widening, CSG hook)
      threeMfExporter.ts   Hand-rolled 3MF zip writer
      csg.ts               manifold-3d wrapper for flush mode (lazy)
      pngExporter.ts       Label face to PNG, black on transparent, 300 DPI (lazy)
      profiles.tsx         Profile registry: generation params plus 2D preview face
      layout.ts            Auto-layout when the symbol or line 2 is off; text fitting
      placement.ts         Nudge math
      layout.check.ts      Self-check for layout.ts
      placement.check.ts   Self-check for placement.ts
      textMetrics.ts       Canvas ink measurement for the two SVG renderers
      download.ts          saveBlob — Blob to <a download>
    types/label.ts         LabelInput, EmbossMode, ExportFormat, BaseStlProfile
    assets/icons/          SVG assets plus index.ts — the single icon manifest
  public/                  Base STLs and the font, served as-is
  tests/                   Vitest suite — 65 tests in 6 files
```

`ARCHITECTURE.md` and `README.md` are the only documents in the repository. Every design decision is stated inline, either here or in a source comment. There is no separate decision log to cross-reference.

## The 3MF pipeline

`api.ts` turns a `LabelInput` into a `.3mf` blob in three stages.

**Stage 1 — orchestration, `web/src/services/api.ts`.**

1. `downloadSingle(label)` or `downloadBatch(labels)` receives the `LabelInput`.
2. `loadGenerator()` dynamic-imports `labelGenerator.ts` and `threeMfExporter.ts`.
3. `generateLabel3mf` calls `buildLabelMeshes`, then `buildThreeMf`.
4. A batch of one returns a single `.3mf`. A larger batch zips through `zipAsync`.

**Stage 2 — geometry, `web/src/services/labelGenerator.ts`.** `buildLabelMeshes(label)` returns `{ baseGeometry, inlayGeometry }`.

1. `getProfile(label.baseProfileId)` resolves the profile.
2. `loadProfile` and `loadFont` fetch the base STL and `helvetiker_bold.typeface.json` in parallel.
3. `widenGeometry` widens the cloned base when `labelWidth` exceeds 1 and the profile declares `widening`.
4. `buildIconMesh` and `buildTextMeshes` build the inlay meshes, then `bakePositionOnly` and `mergeInlayMeshes` merge them into one geometry.
5. Flush mode only: `subtract` from `csg.ts` carves the inlay out of the base, and `mergeVertices(carved, 1e-4)` cleans the result.

**Stage 3 — packaging, `web/src/services/threeMfExporter.ts`.** `buildThreeMf({ title, parts })` returns an `ArrayBuffer`. It writes four entries into one zip with `fflate`'s `zipSync`.

The PNG export is a separate, shorter path off the same `LabelInput`. See [PNG export](#png-export).

## Profiles

Each base design is one `BaseStlProfileEntry` in `web/src/services/profiles.tsx`. One entry owns both the generation parameters and the 2D preview face. Adding a design means appending one constant, so the generator needs no branch and the preview needs no second definition.

```ts
interface BaseStlProfileEntry {
  id: "pred" | "cullenect";                        // extend the union for a new design
  displayName: string;                             // shown in the UI selector
  assetPath: string;                               // file in web/public/, fetched via BASE_URL
  contentOrigin: { x: number; y: number };         // offset added to the STL's bounds.min
  iconBox: ContentRect;                            // content-origin-local millimetres
  line1Box: ContentRect;
  line2Box: ContentRect;
  embossHeight: number;
  raisedZ: "in" | "above";                         // raised-mode Z convention
  supportsFlush: boolean;                          // may CSG-carve for flush mode
  widening?: { extraWidthPerUnit: number };        // omit for 1× only
  previewSize: { width: number; height: number };  // visible face in millimetres
  preview?: { /* optional overrides; anything omitted is derived */ };
}
```

`getProfile(id)` resolves an entry. It falls back to `DEFAULT_PROFILE_ID` for an unknown or missing id. `listProfiles()` returns Cullenect first, then Pred, which is the order the UI buttons use.

**Cullenect V2 (`CULLENECT_PROFILE`)** — 36 × 11 × 1.2 mm, anchored at `(0,0,0)`, flat top. `contentOrigin (0,0)`. `embossHeight 0.4`. `raisedZ "above"`, so the raised inlay sits from `topZ` to `topZ + 0.4`. `supportsFlush true`. No `widening`, so 1× only. This is the default profile.

**Pred (`PRED_PROFILE`)** — 37.8 × 11.5 × 0.8 mm. Snap tabs put the X bounds at `[-1.5, 36.3]` and the Y bounds at `[-0.51, 10.99]`. `contentOrigin (1.5, 0.5)`. `embossHeight 0.4`. `raisedZ "in"`, so the inlay fills the recess from `topZ - 0.4` to `topZ`. `supportsFlush false`, because the recess does not carve cleanly. `widening { extraWidthPerUnit: 42 }` gives 1×, 2× and 3×.

**Both profiles share the same content boxes.** Identical content therefore lands at the same world position on either base.

| Content box | Content-origin-local coordinates | World X |
|-------------|----------------------------------|---------|
| `iconBox` | `{ x1: 1.5, y1: 0.5, x2: 11, y2: 10 }` | `[1.5, 11]` |
| `line1Box` | `{ x1: 11, y1: 5.75, x2: 34.5, y2: 10 }` | `[11, 34.5]`, top half |
| `line2Box` | `{ x1: 11, y1: 0.5, x2: 34.5, y2: 4.75 }` | `[11, 34.5]`, bottom half |

## Coordinate systems

Three spaces appear in the code. Confusing them is the most common source of bugs here.

**1. Three.js world space — the 3D mesh.** The origin is the base STL's `bounds.min` plus `profile.contentOrigin`. `topZ` is `boundingBox.max.z`. Y grows up. `inlayZ()` sets the inlay Z from the emboss mode and `raisedZ`.

| Mode and `raisedZ` | Text mesh Z | Icon mesh Z, after `rotateX(Math.PI)` | Result |
|--------------------|-------------|---------------------------------------|--------|
| `flush`, any profile | `topZ - eh` to `topZ` | `topZ` | CSG carves the cavity; the printed top is flat |
| `raised` + `"in"` (Pred) | `topZ - eh` to `topZ` | `topZ` | The inlay fills the recess, level with the perimeter |
| `raised` + `"above"` (Cullenect) | `topZ` to `topZ + eh` | `topZ + eh` | The inlay rides on the flat body |

`eh` is `profile.embossHeight`, which is 0.4 for both profiles. `rotateX(Math.PI)` negates Z, so `position.z` is the top of an icon mesh and the bottom of a text mesh.

**2. SVG screen space — the 2D preview and the picker thumbnails.** The origin is top-left and Y grows down, the opposite of world space. `getPreviewLayout(profile)` in `profiles.tsx` resolves the preview face. It derives each box that the profile does not override, by Y-flipping the matching content box through `derivePreviewBox`. It defaults the outline to a rounded rectangle of `previewSize`. `LabelPreview.tsx` consumes the resolved layout and adds nothing.

**3. Source SVG space — the raw assets.** Most files in `web/src/assets/icons/` are drawn on an A4 canvas of about 793.7 × 1122.5 units, with the artwork in a small region. Each row in `index.ts` pairs the file with a `viewBox` crop. The 3D extruder ignores the crop, because it measures the parsed path bounds. Both SVG renderers need the crop.

## Content box resolution: layout, then nudge

A profile's content boxes are defaults, not final positions. Two stages sit between a content box and a renderer. All three renderers run both stages in the same order, which is what keeps the preview honest.

**Stage 1 — auto-layout, `web/src/services/layout.ts`.** It rewrites the default boxes for what the label actually carries.

| Case | Result |
|------|--------|
| No symbol: `iconSvg` is empty | Both lines reclaim the icon column, so `x1` moves to `iconBox.x1` |
| No line 2: no text and no `line2Svg` | Line 1 moves to the vertical middle. It moves; it does not resize |
| Neither | Line 1 takes the union of both boxes, so it centres and grows |

`resolveRects` works in Y-up space for the generator. `resolveBoxes` works in Y-down space for the preview and the PNG exporter.

**Stage 2 — nudge, `web/src/services/placement.ts`.** `adjustRect` (Y-up) and `adjustBox` (Y-down) apply a `{ dx, dy, scale }` delta on top of whatever layout produced. A nudge therefore always reads as an offset from where layout put the element. `dy` uses the world convention, so a positive value moves up; `adjustBox` flips the sign.

`scale` is a trust boundary. It arrives as free text from a number input whose `min` only gates the spinner. `adjustRect` and `adjustBox` clamp it to `MIN_SCALE = 0.1`. A scale of 0 collapses the extruded mesh to a point, a negative value mirrors the box and inverts triangle winding, and `NaN` fails the `>=` comparison and clamps too. Never read `placement.scale` directly; route through these two functions.

**Text fitting.** The two SVG renderers call `fitText` in `layout.ts`, which takes a `MeasureInk` function. `textMetrics.ts` supplies the browser one, `measureLabelInk`. It reads the canvas `actualBoundingBox*` fields rather than `metrics.width`, because `width` is the advance and overshoots by the side bearings. Nothing about the font metrics is hardcoded: helvetiker_bold has a cap height of 1.013 em and Arial has 0.716.

**Why `layout.ts` and `placement.ts` import nothing.** Their siblings `layout.check.ts` and `placement.check.ts` run under plain `node`, with no bundler and no DOM. `npm run check` runs both. Their headline assertion is cross-space agreement: nudging then projecting must equal projecting then nudging. That assertion catches a Y sign flip or a bad width between the Y-up generator and the Y-down renderers. Keep both files free of imports other than their own siblings.

## Text and SVG rendering in 3D

**Tracking.** `generateShapesWithTracking` in `labelGenerator.ts` multiplies each glyph's horizontal advance by `TRACKING = 0.95`. It is a hand-rolled clone of Three.js `FontLoader`'s internal `createPaths`. Three.js glyph advances are generous, and `chooseTextSizeForBox` shrinks the font until the text fits the box. Wide tracking therefore forces a smaller font, which gives thinner strokes and worse slicer detail. Shrinking the gaps leaves the glyphs untouched and lets the font size grow.

**Font sizing.** `chooseTextSizeForBox` calls `largestFittingSize` from `layout.ts`. That function binary-searches the descending grid `start, start - 0.1, start - 0.2, …` for the largest size whose predicate returns true. `start` is `Math.max(6, maxHeight * 1.4)` and the floor is `1.2`. The search costs about 6 probes where the previous linear walk cost 18 to 70. Each probe builds a `ShapeGeometry`, which is a full earcut triangulation, so the saving is real on a 15-label batch. The grid is materialised by repeated subtraction, not by `start - k * step`, because the two disagree in the last bits of a float once error accumulates. The 0.1 grid, the start value and the floor are all load-bearing for the shipped output. Do not replace the search with a closed-form solve.

**SVG icons.** `buildSvgMeshInBox` runs `SVGLoader.parse`, then `SVGLoader.createShapes`, then `ExtrudeGeometry` with `depth = embossHeight`, `bevelEnabled: false` and `curveSegments: 10`. It then rotates the geometry by `Math.PI` around X to flip SVG-Y into world-Y. It uses a rotation rather than `scale.y = -1` so that triangle winding stays outward. It fits the result into the target box with `Math.min`, so the artwork never stretches, and lifts it to `inlayZ().iconZ`.

## 3MF export structure

Every export is a zip of four entries.

```
mylabel.3mf (zip)
├── [Content_Types].xml             MIME types for .rels, .model, .config
├── _rels/.rels                     package → /3D/3dmodel.model
├── 3D/3dmodel.model                geometry XML
└── Metadata/model_settings.config  Bambu and Orca part naming plus slot assignment
```

**`3D/3dmodel.model`** is 3MF Core 1.0 with a `<components>` assembly. It holds three `<object>` elements — id 1 is the `Label Body` mesh, id 2 is the `Text & Icons` mesh, id 3 is the assembly that references both — and one `<build><item objectid="3"/>`. Three decisions shape it:

- **The whole inlay is one `<mesh>`.** Every letter and every icon triangle shares one vertex and index array. Slicers never auto-split a single mesh, so the user gets one paintable `Text & Icons` child instead of roughly 50 parts per label.
- **A `<components>` assembly, not a slicer extension.** Orca, Prusa and Cura all show one model with two named children from standard 3MF alone.
- **Indexed geometry.** Every geometry passes through `mergeVertices(1e-4)` in `bakePositionOnly`. `STLLoader` and `ExtrudeGeometry` both emit non-indexed geometry where each triangle owns three unique vertices. Written straight to 3MF, that makes OrcaSlicer report `3 × triangleCount` non-manifold edges — the classic "26112 non-manifold edges". Deduplication drops the count to about zero. This step is load-bearing. Do not remove it. The tolerance of 1e-4 mm is 0.1 µm, far below any print feature and far above float noise from the matrix bake.

**`Metadata/model_settings.config`** is specific to Bambu Studio and OrcaSlicer. Every other slicer ignores it, so `buildThreeMf` always emits it. Each `<part>` carries a `name` and an `extruder` metadata entry.

```xml
<config>
  <object id="3">
    <metadata key="name" value="M3x10 Screw"/>
    <part id="1" subtype="normal_part">
      <metadata key="name" value="Label Body"/>
      <metadata key="matrix" value="1 0 0 0 0 1 0 0 0 0 1 0 0 0 0 1"/>
      <metadata key="extruder" value="1"/>
    </part>
    <part id="2" subtype="normal_part">
      <metadata key="name" value="Text &amp; Icons"/>
      <metadata key="matrix" value="1 0 0 0 0 1 0 0 0 0 1 0 0 0 0 1"/>
      <metadata key="extruder" value="2"/>
    </part>
  </object>
</config>
```

Bambu and Orca ignore the 3MF `name` attribute and read names from this file. Prusa and Cura read the `name` attribute. `buildThreeMf` emits both. `extruder` is a 1-indexed AMS slot, not a specific filament: the body gets 1 and the inlay gets 2. A user with fewer filaments loaded falls back to slot 1 with a non-blocking warning.

## Flush mode and the CSG carve

`buildLabelMeshes` runs a CSG subtract between mesh building and export when `embossMode === "flush"` and `profile.supportsFlush`. It positions the inlay at `[topZ - eh, topZ]`, calls `subtract(baseGeometry, inlayGeometry)` from `csg.ts`, then runs `mergeVertices(carved, 1e-4)` on the carved base. Both the carved base and the raw inlay ship in the 3MF, so the slicer sees two clean non-overlapping solids and the print has a flat top with colour regions.

- **Flush carves geometry rather than emitting `negative_part`.** A carved mesh is plain geometry that every slicer understands. `subtype="negative_part"` works only in Bambu Studio and OrcaSlicer.
- **manifold-3d loads lazily.** `loadRuntime()` in `csg.ts` dynamic-imports the module and the wasm. Nothing downloads until the first flush export.
- **The wasm arrives through Vite's `?url`.** `import wasmUrl from "manifold-3d/manifold.wasm?url"` makes Vite emit a hashed asset into `dist/assets/`, and `csg.ts` hands that URL to manifold's `locateFile`. There is no prebuild copy step.
- **The base must be 2-manifold.** manifold-3d throws `input is not 2-manifold` otherwise. Both shipped STLs pass. A custom base STL may need repair in Blender or MeshLab.
- **A flush request on a profile without `supportsFlush` downgrades to raised silently.** `buildLabelMeshes` clamps the mode, and `App.tsx` also hides the toggle. Both layers are deliberate.

## PNG export

`web/src/services/pngExporter.ts` renders a base-agnostic label face. It uses its own fixed 36 × 11 mm layout — `FACE`, `ICON_BOX`, `LINE1_BOX`, `LINE2_BOX` — at `DPI = 300`, drawing black `INK` on a transparent background.

It ignores `baseProfileId`, the body outline and the emboss mode on purpose. A PNG is label content for a tape printer such as the Brother P-touch, not a render of any base STL. Its boxes match the Cullenect face, which is the Y-flip of the shared content boxes. A PNG and a 3MF of the same label are therefore not identical on Pred. That is design, not drift.

`buildLabelFaceSvg` builds an SVG string, and `rasterize` turns it into a blob through a data URL, an `<img>`, a `<canvas>` and `canvas.toBlob`. Icons inline as `<image>` with a `feColorMatrix` filter that forces any source colour to solid black while preserving alpha. An SVG loaded through `<img>` runs no script and does not taint the canvas.

`buildLabelFaceSvg` is exported for the tests. Rasterising needs a real canvas, but the layout it produces is assertable without one.

## Code splitting

The bundle splits into five chunks at `await import(…)` boundaries. Numbers below are from `npm run build` on the current `main`.

| Chunk | Gzip | Loads when |
|-------|-----:|------------|
| `index-*.js` — React, UI, `profiles.tsx`, `layout.ts`, `placement.ts` | 58.6 kB | Page load |
| `browser-*.js` — fflate | 5.8 kB | First 3MF download or first batch export |
| `labelGenerator-*.js` + `threeMfExporter-*.js` — Three.js, builder, 3MF writer | 58.0 kB | First 3MF download |
| `pngExporter-*.js` | 1.1 kB | First PNG export |
| `manifold-*.js` + `manifold-*.wasm` + `csg-*.js` | 205.5 kB | First flush export |

`loadGenerator()` in `api.ts` dynamic-imports the generator and the exporter. The flush branch of `buildLabelMeshes` dynamic-imports `csg.ts`, which chains to manifold. `api.ts` also dynamic-imports fflate for `zipAsync`, because fflate's async `zip` inlines its worker source and a static import would drag it into the main chunk.

Profile constants live in `services/profiles.tsx` rather than `labelGenerator.ts` precisely so `App.tsx` can read them at page load without pulling Three.js across the lazy boundary. A static import from any UI file into `labelGenerator.ts` or `csg.ts` collapses the chunks back into one.

## Verification

Three commands must pass before any change lands. Run them from `web/`.

1. `npm run check` — runs `placement.check.ts` and `layout.check.ts` under plain `node`. Both print `ok` on success.
2. `npm test` — runs the Vitest suite: 65 tests in 6 files.
3. `npm run build` — runs `tsc -b`, then `vite build`.

`.github/workflows/deploy.yml` runs `npm run build` only. It does not run `npm run check` or `npm test`, so run them locally.

The Vitest suite lives in `web/tests/` and is configured by `web/vitest.config.ts`, which merges the app's own `vite.config.ts`. Tests therefore see the same module resolution, the same `import.meta.glob` for the icon assets and the same `import.meta.env.BASE_URL`.

- `tests/setup.ts` replaces `globalThis.fetch` with `publicFetch`, which serves `web/public/` off disk. Tests assert against the real STLs and the real font, not against mocked geometry. It also lends a jsdom `DOMParser` to the node environment, because Three.js `SVGLoader` needs one.
- The environment is `node`. Only `tests/labelForm.test.tsx` needs a DOM, and it opts in with a per-file `@vitest-environment` docblock. fflate's async `zip` wants `worker_threads`, not a Blob-URL worker, which is why node is the default.
- `tests/geometry.test.ts` runs inlay-placement assertions against both profiles through `describe.each`, plus label widening and emboss mode.
- `tests/threeMf.test.ts` unzips the export and parses the XML for both profiles.
- `tests/batch.test.ts` covers 3MF and PNG batch downloads, including filename collisions.
- `tests/png.test.ts` asserts the PNG face SVG.
- `tests/regressions.test.ts` holds one test per bug already fixed: the degenerate `placement.scale` clamp, retry after a failed asset fetch, preview-to-mesh agreement, and the two node self-checks.

## Hot spots

| Task | Where |
|------|-------|
| Tracking and 3D font sizing | `labelGenerator.ts` — `TRACKING`, `chooseTextSizeForBox`; `layout.ts` — `largestFittingSize` |
| Text fitting in the preview and the PNG | `layout.ts` — `fitText`; `textMetrics.ts` — `measureLabelInk` |
| Symbol-off and line-2-off auto-layout | `layout.ts` — `resolveRects` (Y-up), `resolveBoxes` (Y-down) |
| Nudge math and the scale clamp | `placement.ts` — `adjustRect`, `adjustBox`, `MIN_SCALE` |
| Emboss height or a content box | `profiles.tsx` — `embossHeight`, `iconBox`, `line1Box`, `line2Box`, `contentOrigin` |
| Add a profile | Put the STL in `web/public/`; add one `BaseStlProfileEntry` to `profiles.tsx` and register it in `PROFILES`; extend `BaseStlProfileId` in `types/label.ts`. The preview derives unless you add a `preview` override |
| Inlay Z per mode | `labelGenerator.ts` — `inlayZ()` |
| The CSG carve | `csg.ts`; the flush branch of `buildLabelMeshes` |
| 3MF XML, Bambu config, AMS slots | `threeMfExporter.ts`; the `parts` array in `api.ts` |
| PNG style, DPI, layout | `pngExporter.ts` — `buildLabelFaceSvg`, `DPI`, `INK`, `FACE` |
| Move a box in the 2D preview | The profile's `preview` override in `profiles.tsx`, or the content box it derives from |
| Add an icon | Put the SVG in `web/src/assets/icons/`; add one row to `DEFS` in `icons/index.ts`. `import.meta.glob` picks up the file and `iconsByKind` builds both pickers |
| Batch diameters and lengths | `SizeBatch.tsx` — `LENGTHS`, `DIAMETERS` |
| Export file names | `App.tsx` — `slugifyTitle`, `tokenFor`, `buildBatchZipFileName`; `api.ts` — `slugify`, `uniqueName` |
| 2× and 3× width math | `labelGenerator.ts` — `widenGeometry`, `contentXOffset`; `widening` in `profiles.tsx` |
| Deployed URL and build base | `vite.config.ts` — `base`; `.github/workflows/deploy.yml`; the Pages custom-domain setting |

## Gotchas

- **`mergeVertices` is load-bearing.** Drop it and slicers report `3 × triangleCount` non-manifold edges.
- **`labelGenerator.ts` keeps per-call state in module variables.** `activeProfile`, `activeLoaded`, `activeFont`, `activeMode`, `activePlacement` and `contentXOffset` are set at the top of each `buildLabelMeshes` call, and the helpers read them as globals. Sequential calls only.
- **A `preview` override is a second copy of the numbers.** `derivePreviewBox` assumes the content origin sits at preview `(0, faceHeight)`. That holds for Cullenect. It does not hold for Pred, whose snap tabs put `bounds.min.x` at world −1.5, so Pred's preview x equals world x plus 1.5. Pred's overrides encode exactly that offset. Change a Pred content box and you must shift the override by the same amount, or the preview stops matching the exported mesh.
- **The PNG face is base-agnostic on purpose.** See [PNG export](#png-export).
- **`placement.scale` is a trust boundary.** Clamp through `adjustRect` or `adjustBox`.
- **The lazy caches evict on rejection.** `profileCache` and `fontPromise` in `labelGenerator.ts`, and `runtimePromise` in `csg.ts`, memoise a promise rather than a settled value, so concurrent callers share one fetch. Each attaches a `.catch` that un-caches a failure. Without it, one transient network error would make every later download re-throw the stale error until the page reloads.
- **`mergeInlayMeshes` throws on a merge failure.** It previously fell back to `baked[0]`, which silently dropped the other inlay parts, so text or the icon vanished from the exported 3MF with no error anywhere.
- **Dynamic-import boundaries are deliberate.** A static import from a UI file into `labelGenerator.ts` or `csg.ts` collapses the chunks.
- **Use `import.meta.env.BASE_URL` for runtime assets.** An absolute path such as `/asset.png` 404s when Pages serves the site from a subpath. The manifold wasm is exempt, because Vite hashes it into `dist/assets/` and `csg.ts` hands manifold the resulting URL.
- **There is no backend.** The upstream `server/` Express prototype is deleted. Do not reintroduce one to solve a generation problem.
