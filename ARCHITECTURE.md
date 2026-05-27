# Architecture

How the generator turns a few form inputs into a binary 3MF ready for slicing. Read this before you modify `labelGenerator.ts`, add a base STL profile, touch coordinate constants, or change the CSG carve — it's where the "why is this number what it is?" answers live. For the user-facing overview see [README.md](README.md).

Everything runs **in the browser** — there is no server in the deployed flow. Three.js + fflate live in a lazy chunk that only loads on the first Download; manifold-3d's wasm is a second lazy chunk that only loads on the first flush export.

---

## High-level pipeline

```
User input
  LabelForm (custom)  or  PredefinedSelector (catalogue)
  + Base STL toggle, + Emboss Mode toggle (Cullenect only)
        │  LabelInput { title, line1, line2, iconSvg, line2Svg?,
        │               iconText?, labelWidth?, baseProfileId, embossMode }
        ▼
services/api.ts  — downloadSingle / downloadBatch
        │  dynamic import → lazy chunk
        ▼
services/labelGenerator.ts  — buildLabelMeshes(label) → { baseGeometry, inlayGeometry }
  1. Resolve profile (services/profiles.tsx)
  2. Lazy-fetch the profile's base STL + font
  3. Clone base mesh, optionally widen (Pred 2×/3×)
  4. Build inlay meshes (text + icon)
  5. Bake transforms, mergeVertices → indexed geometry
  6. mergeGeometries → one inlay mesh
  ── if embossMode === "flush" && profile.supportsFlush ──
  7. dynamic-import services/csg.ts (manifold wasm)
  8. CSG subtract inlay from base → carved base
  9. mergeVertices again on the post-CSG base
        ▼
services/threeMfExporter.ts  — buildThreeMf({ title, parts }) → ArrayBuffer
  [Content_Types].xml · _rels/.rels · 3D/3dmodel.model (assembly + 2 leaf objects)
  · Metadata/model_settings.config (Bambu/Orca naming + AMS slots) · zip via fflate
        ▼
  Blob → <a download> → .3mf      (batch: fflate.zipSync of many .3mf → .zip)
```

---

## Base STL profiles

Each base design is a single `BaseStlProfileEntry` in `web/src/services/profiles.tsx`. One entry owns the generation params (asset path, content boxes, emboss semantics) **and** the 2D-preview face, so adding a design is appending one constant — no generator branching, and no separate preview definition to keep in sync.

```ts
interface BaseStlProfileEntry {
  id: "pred" | "cullenect";          // extend the union for new designs
  displayName: string;                // shown in the UI selector
  assetPath: string;                  // relative to BASE_URL (in web/public/)
  contentOrigin: { x: number; y: number };  // offset added to bounds.min
  iconBox: ContentRect;               // content-origin-local coords
  line1Box: ContentRect;
  line2Box: ContentRect;
  embossHeight: number;
  raisedZ: "in" | "above";            // raised-mode Z convention
  supportsFlush: boolean;             // can CSG-carve for flush mode
  widening?: { extraWidthPerUnit: number };  // omit → 1U only
  previewSize: { width: number; height: number };  // visible face (mm) for the preview
  preview?: { /* optional box/outline overrides; otherwise derived (see below) */ };
}
```

`getPreviewLayout(profile)` resolves the preview: each box not overridden is derived by Y-flipping the matching content box, and the outline defaults to a rounded rectangle of `previewSize`. Cullenect uses pure derivation; Pred overrides every box plus the outline for its snap-tab shape.

**Pred Gridfinity (`PRED_PROFILE`)** — 37.8×11.5×0.8 mm; snap tabs extend X bounds to `[-1.5, 36.3]`. Recessed interior with a raised perimeter. `contentOrigin (1.5, 0.5)`, `embossHeight 0.4`, `raisedZ "in"` (inlay fills the recess from `topZ-0.4` to `topZ`, top coplanar with the perimeter). `supportsFlush false` (the recess wouldn't carve cleanly). `widening { extraWidthPerUnit: 42 }` for 1×/2×/3×.

**Cullenect V2 (`CULLENECT_PROFILE`)** — 36×11×1.2 mm, anchored at `(0,0,0)`, flat top, no recess. `contentOrigin (0,0)` (keeps content at the same world X as Pred). `embossHeight 0.4`, `raisedZ "above"` (raised inlay sits from `topZ` to `topZ+0.4`). `supportsFlush true`. No `widening` (1U only).

**Shared content boxes.** Both profiles use the same `iconBox`/`line1Box`/`line2Box`, so identical content renders at the same visual position on either base:

| Box | Content-local coords | World coords (both) |
|-----|----------------------|---------------------|
| iconBox | `{ x1: 1.5, y1: 0.5, x2: 11, y2: 10 }` | X [1.5, 11] |
| line1Box | `{ x1: 11, y1: 5.75, x2: 34.5, y2: 10 }` | X [11, 34.5], top half |
| line2Box | `{ x1: 11, y1: 0.5, x2: 34.5, y2: 4.75 }` | X [11, 34.5], bottom half |

---

## Coordinate systems

Three independent spaces show up in the code. Mixing them up is the #1 source of bugs.

**1. Three.js world space (3D mesh).** Origin = active profile's base STL `bounds.min` + `profile.contentOrigin`. `topZ = boundingBox.max.z`. **Y grows up.** Inlay Z depends on emboss mode + `raisedZ`:

| Mode + raisedZ | Text mesh Z | Icon mesh Z (after rotateX π) | Result |
|----------------|-------------|-------------------------------|--------|
| flush (any) | `topZ - eh` → `topZ` | `topZ` → carved by CSG | Inlay carved into base, flush top |
| raised + "in" (Pred) | `topZ - eh` → `topZ` | `topZ` | Inlay fills recess, top at perimeter |
| raised + "above" (Cullenect) | `topZ` → `topZ + eh` | `topZ + eh` | Inlay rides above the flat body |

(`eh` = `profile.embossHeight`, 0.4 mm for both.)

**2. SVG screen space (2D preview, picker thumbnails).** Origin top-left, **Y grows down** — opposite of 3D. `getPreviewLayout()` in `profiles.tsx` resolves each profile's preview face: by default it Y-flips the generation content boxes into preview boxes and draws a rounded-rect outline; a profile may override any of that (Pred does, for its snap-tab outline). `LabelPreview.tsx` just consumes the resolved layout.

**3. Source SVG space (raw assets).** Most assets in `web/src/assets/` have an A4 viewBox (≈793.7×1122.5) with the drawing in a small region; each consumer pairs the asset with an explicit `viewBox` crop. The 3D extruder ignores the crop (it measures the parsed path bounds), but the 2D previews need it — so an asset's paths must sit somewhere visible.

---

## 3MF export structure

Every export is a zip of four files:

```
mylabel.3mf (zip)
├── [Content_Types].xml             MIME for .rels, .model, .config
├── _rels/.rels                     package → /3D/3dmodel.model
├── 3D/3dmodel.model                geometry XML (below)
└── Metadata/model_settings.config  Bambu/Orca part naming + slot assignment
```

**`3D/3dmodel.model`** — 3MF Core 1.0 with a `<components>` assembly: three `<object>`s (id 1 Label Body mesh, id 2 Text & Icons mesh, id 3 assembly referencing both) and a single `<build><item objectid="3"/>`. Three design points:

- **One `<mesh>` for the whole inlay.** All letters + icon triangles share one vertex/index array. Slicers don't auto-split a single mesh, so the user gets one paintable "Text & Icons" child instead of N parts per letter.
- **`<components>` assembly** produces "one model, two named children" in Orca/Prusa/Cura outliners, using only standard 3MF (no slicer extensions).
- **Indexed geometry.** Every mesh passes through `mergeVertices(1e-4)`. Non-indexed input (STL/`ExtrudeGeometry` give every triangle its own 3 vertices) makes slicers report `3 × triangleCount` non-manifold edges — the classic "26112 non-manifold edges." Dedup drops it to ~0. **This step is load-bearing.**

**`Metadata/model_settings.config`** — Bambu Studio / OrcaSlicer specific (other slicers ignore it). Per `<part>` it carries `<metadata key="name">` and `<metadata key="extruder">`:

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
      <metadata key="name" value="Text & Icons"/>
      <metadata key="matrix" value="1 0 0 0 0 1 0 0 0 0 1 0 0 0 0 1"/>
      <metadata key="extruder" value="2"/>
    </part>
  </object>
</config>
```

Bambu/Orca ignore the standard 3MF `name` attribute and read names from here; Prusa/Cura read the `name` attribute (we emit both). `extruder` is a 1-indexed AMS **slot** (not a specific filament): body→1, inlay→2. Multi-filament users auto-paint; single-filament users print everything in slot 1 with a non-blocking warning.

---

## Flush mode + manifold-3d CSG

When `embossMode === "flush"` and `profile.supportsFlush`, `buildLabelMeshes` runs a CSG subtract between mesh-build and export: the inlay is positioned at `[topZ-eh, topZ]` (inside the body top), `Manifold.subtract(base, inlay)` carves an exact cavity, then `mergeVertices(1e-4)` cleans the post-CSG base. Both the carved base and the (raw) inlay ship in the 3MF, so the slicer sees two clean non-overlapping solids and the print is a flat top with color regions.

- **Lazy-loaded.** manifold-3d is ~200 kB gzip (482 kB wasm + JS). `services/csg.ts`'s `loadRuntime()` dynamic-imports the module + wasm, so nothing downloads until you export with Cullenect + Flush.
- **Wasm via Vite `?url`.** `import wasmUrl from 'manifold-3d/manifold.wasm?url'` — Vite emits it as a hashed asset in `dist/assets/` and we pass the URL to manifold's `locateFile`. No `prebuild` copy step.
- **Manifold requirement.** The base STL must be 2-manifold (closed, watertight, consistent winding) or manifold-3d throws "input is not 2-manifold." Both shipped STLs pass; a custom base STL may need cleanup in Blender/MeshLab.

---

## Code-splitting

Three chunk groups, split by `await import(…)` boundaries:

| Chunk | Gzip | Loaded when |
|-------|-----:|-------------|
| `index-*.js` (React + UI + profiles + fflate) | ~63 kB | Page load |
| `labelGenerator-*.js` + `threeMfExporter-*.js` (Three.js + builder + 3MF writer) | ~58 kB | First Download |
| `manifold-*.js` + `*.wasm` + `csg-*.js` | ~204 kB | First Flush export |

`api.ts`'s `loadGenerator()` dynamic-imports the generator + exporter; `labelGenerator.ts`'s flush branch dynamic-imports `csg.ts`, which chains to manifold. Profile constants live in `services/profiles.tsx` (not `labelGenerator.ts`) precisely so `App.tsx`'s selector can read them at page load **without** pulling Three.js across the lazy boundary. A static import from any UI file into `labelGenerator.ts`/`csg.ts` collapses the chunks back into one.

---

## Text & SVG rendering

**Tracking.** Three.js glyph advances are generous; the auto-sizer (`chooseTextSizeForBox`) shrinks the font to fit the box, so wide tracking → smaller font → thinner strokes → worse slicer detail. `generateShapesWithTracking` (a hand-rolled clone of FontLoader's `createPaths`) multiplies each glyph's horizontal advance by `TRACKING = 0.95` — gaps shrink, glyphs are untouched, font ends up larger and strokes thicker.

**Icon-as-text (`iconText`).** The "Use wrench size as icon" toggle replaces the SVG icon with text like `TX10`. `buildIconTextMeshes` splits on the alpha/digit boundary (`^([A-Za-z]+)(\d+.*)$`) so `TX` and `10` each fill half the icon box at a larger size. `LabelPreview.renderIcon` mirrors this exactly.

**SVG icons (`buildSvgMeshInBox`).** `SVGLoader.parse` → `createShapes` → `ExtrudeGeometry` (depth = `embossHeight`, no bevel, 10 curve segments) → **rotate `Math.PI` around X** to flip SVG-Y into 3D-Y (rotation, not `scale.y=-1`, so winding stays outward) → fit into the target box with `Math.min` (no stretch) → translate and lift to `inlayZ().iconZ`.

---

## Hot spots

| Task | Where |
|------|-------|
| Text tracking / font-size search | `labelGenerator.ts` (`TRACKING`, `chooseTextSizeForBox`) |
| Emboss depth / content boxes for an STL | `profiles.tsx` (`embossHeight`, `iconBox`, `line1Box`, `line2Box`, `contentOrigin`) |
| Add a base STL design | STL → `web/public/`; one `BaseStlProfileEntry` in `profiles.tsx` (generation fields + `previewSize`) registered in `PROFILES`; extend `BaseStlProfileId` in `types/label.ts`. Preview auto-derives unless you add a `preview` override |
| Inlay Z per mode | `labelGenerator.ts` (`inlayZ()`) |
| The CSG carve | `csg.ts` + the flush branch of `buildLabelMeshes` |
| 3MF XML / Bambu config / slots | `threeMfExporter.ts` |
| Move boxes in the 2D preview | the profile's `preview` override in `profiles.tsx` — or just move the content boxes, which the preview derives from |
| Add an icon | drop SVG in `web/src/assets/icons/` + one row in `icons/index.ts` (`id`/`label`/`file`/`viewBox`/`kind`); for predefined use, set the label's `icon` id in `api.ts` |
| Add a predefined label | append to `PREDEFINED_DATA` in `api.ts` |
| 2×/3× width math (Pred) | `labelGenerator.ts` (`widenGeometry`, `contentXOffset`); `widening` in `profiles.tsx` |
| Deployed URL / build base | `vite.config.ts` (`base`), `.github/workflows/deploy.yml`, Pages custom-domain setting |

---

## Gotchas

- **`mergeVertices` is load-bearing.** Without `mergeVertices(1e-4)` on every geometry, slicers report `3 × triangleCount` non-manifold edges. Don't remove it.
- **Per-call module state in `labelGenerator.ts`.** `activeProfile`, `activeLoaded`, `activeFont`, `activeMode`, `contentXOffset` are module-level mutables set at the top of each `buildLabelMeshes` call; helpers read them as globals. **Not concurrent-safe** — sequential calls only.
- **2D preview and 3D mesh share one profile source.** Preview boxes derive from the generation content boxes (Y-flipped) unless a profile sets an explicit `preview` override — there's no second file to keep in sync.
- **Bambu/Orca naming needs `Metadata/model_settings.config`.** They ignore the 3MF `name` attribute; Prusa/Cura use it. We emit both.
- **Flush silently downgrades to raised** on profiles without `supportsFlush` (defense-in-depth; the UI also hides the toggle).
- **Flush needs a 2-manifold base STL** or manifold-3d throws.
- **Dynamic-import boundaries are deliberate** (see Code-splitting). A static import from a UI file into the generator/CSG collapses the chunks.
- **GitHub Pages base path.** Reference runtime assets via `import.meta.env.BASE_URL`, never absolute `/asset.png`, or they 404 on a subpath. (The manifold wasm is exempt — Vite hashes it into `dist/assets/` and we hand manifold the URL.)
- **`buildInfo.ts` is auto-generated** by `scripts/write-build-info.mjs` on every `predev`/`prebuild`. Don't edit or hand-commit it.
- **`server/` is dead.** The legacy Express prototype still emits single-solid STL, uses `helvetiker_regular`, has no tracking/profiles/CSG, and ships a 6-label stub. Don't copy patterns from it or update it unless asked.
