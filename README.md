# Gridfinity Label Generator

**Working site: https://labels.doster.cc**

A browser-based tool that generates custom **3MF labels** for [Gridfinity bins](https://www.printables.com/model/592545-gridfinity-bin-with-printable-label-by-pred-parame). Everything runs entirely in the browser — no server or install required. The site above is fully functional as-is; you're also free to fork or clone it to run your own instance.

## What it does

The generator composites a base label STL with embossed text and clipart icons, then exports a multi-part `.3mf` ready to slice. Each export contains two named parts:

- **Label Body** — the base structure of the label
- **Text & Icons** — every letter, the icon, and the optional line-2 image, merged into one paintable inlay

The slicer shows these as a single grouped model with two paintable children. For multi-color printers (Bambu AMS / Prusa MMU / OrcaSlicer multi-tool) the parts are pre-assigned to filament slots 1 and 2, so body and inlay auto-paint with whatever colors are loaded. Single-filament printers print the whole label in slot 1 — the color-change-at-layer-3 workflow under [Printing tips](#printing-tips) still applies.

Each label consists of:

- **Icon** (left): a clipart symbol — drive types (Torx, Phillips, slot, hex, Robertson) and parts (nut, nylock, washers, lock washer, insert, square nut, T-nut, roll-in T-nut)
- **Line 1** (top right): text, auto-sized to fill its box
- **Line 2** (bottom right): text, or one of 10 technical screw-profile images (button head, countersunk, cylinder head, grub screw, hex head, low head, pan head, and self-tapping variants)
- **Emboss depth**: 0.4 mm — two layers at 0.2 mm layer height, which prints solidly with a clean color change

## Base STL designs

Selectable in the **Output** selector at the top of the page (alongside the PNG option):

### Pred Gridfinity (default)
The original [Pred-designed Gridfinity bin label STL](https://www.printables.com/model/592545-gridfinity-bin-with-printable-label-by-pred-parame), 37.8×11.5 mm with snap tabs and a recessed interior. Text and icons fill the recess so the printed inlay is coplanar with the outer perimeter. Supports 1× / 2× / 3× widths.

### Cullenect V2
A 36×11 mm flat-bodied alternative, 1U wide. Text and icons either ride on top of the flat surface (**Raised** mode) or are CSG-carved into the body so the print is dead-flat (**Flush** mode). Flush is ideal for multi-material printing where you want a smooth top with color regions instead of physical relief. The Emboss Mode toggle appears only when Cullenect is selected; Pred is raised-only.

## Using it

- **Custom label** — enter your own text and pick an icon. Exports a single file.
- **Predefined labels** — select from a curated catalogue of CNC Kitchen fasteners and inserts. One label exports a single file; multiple export a `.zip` with one file per label.
- **Output** — the **Output** selector (top bar) chooses **Pred Gridfinity** or **Cullenect V2** (printable 3D `.3mf` models) or **PNG** (a print-ready, black-on-transparent image of the label face at true physical size — for label printers such as the Brother P-touch). PNG follows the same single-file / zip-for-multiple behaviour. Exported filenames carry the type (`-pred` / `-cullenect` / `-png`) so the variants don't collide on download.

Predefined categories: heat inserts (metric M2–M10, imperial #2-56–3/8″-16), socket-head cap screws (M1.6–M5, labelled with Torx drive size TX5–TX25), and hex nuts / nylock nuts / standard washers / large washers (M2–M8).

## Printing tips

- **Layer height**: 0.2 mm
- **Wall generator**: Arachne recommended for sharper detail on thin strokes
- **Multi-color (AMS / MMU)**: load filaments into slots 1 (body) and 2 (text/icons); the slicer auto-paints
- **Single-filament with color change**: set a color change at **layer 3** so the embossed text prints in a contrasting colour

### macOS users

If `.3mf` files trigger Apple's Gatekeeper "could not verify" prompt instead of opening your slicer on double-click, set your slicer as the default `.3mf` handler: right-click any `.3mf` → Get Info → "Open with: OrcaSlicer" → "Change All…". Future downloads then route straight to the slicer.

## How it works

Generation runs entirely in the browser using [Three.js](https://threejs.org/) for mesh work, [fflate](https://github.com/101arrowz/fflate) for the 3MF zip, and (Cullenect flush mode only) [manifold-3d](https://github.com/elalish/manifold) for the CSG carve:

1. Load the selected base STL (`GridfinityBinLabel.stl` or `CullenectBinLabel.stl`) as the base body.
2. Parse SVG clipart with `SVGLoader`, extrude to 3D, and scale it into the icon box.
3. Generate font glyphs from `helvetiker_bold.typeface.json` with a custom tracking function (tighter letter spacing → larger font size → thicker strokes → more slicer-friendly).
4. Extrude all text and icon shapes to 0.4 mm and position them per the active profile's emboss mode.
5. **Cullenect Flush only**: lazy-load manifold-3d's wasm and subtract the inlay from the base so both parts are individually manifold with a flat top.
6. Merge the inlay shapes (line 1 + line 2 + icon) into a single indexed `BufferGeometry` — disconnected triangle islands in one mesh, so the slicer treats the whole inlay as one paintable child.
7. Hand-roll the 3MF zip: `[Content_Types].xml`, `_rels/.rels`, `3D/3dmodel.model` (a `<components>` assembly over two leaf objects), and `Metadata/model_settings.config` (Bambu/Orca part names + `extruder` slot assignments).
8. For 2× / 3× wide Pred labels, widen the base by shifting vertices right of the geometric midpoint and re-centre the content.

The generator pipeline is code-split into a lazy chunk that only fetches on the first Download click; the manifold-3d wasm is a second lazy chunk that only fetches on the first flush export. Users who never download pay neither cost.

## Design notes

The non-obvious choices behind the current pipeline — worth knowing before changing them:

- **3MF only, no STL.** 3MF is universally supported by modern slicers and is the only format that yields the grouped multi-part result. STL fragmented a single label into ~50 "parts" (one per letter) on the slicer's split tool.
- **One model, two paintable children.** The 3MF uses a standard `<components>` assembly (no slicer-specific extensions) so users assign filaments to "Label Body" and "Text & Icons" in two clicks.
- **The whole inlay is one mesh.** Line 1 + line 2 + icon are merged into a single `<mesh>` of disconnected triangle islands. Slicers never auto-split a single mesh, so everything-that-isn't-the-base stays one paintable child.
- **Vertices are deduped before export (`mergeVertices`, 1e-4 mm).** STL/`ExtrudeGeometry` output is non-indexed — every triangle owns 3 unique vertices. Written straight to 3MF, OrcaSlicer reports *every* edge as non-manifold (the classic "26112 non-manifold edges"). Dedup → indexed geometry → clean slice. **This step is load-bearing; don't remove it.**
- **Bambu/Orca need their own naming file.** Those slicers ignore the 3MF `name` attribute and read part names from a proprietary `Metadata/model_settings.config`. We always emit it (other slicers ignore it harmlessly), including per-part `extruder` slot numbers (body=1, inlay=2). Prusa honors the standard `name`; Cura ignores the config but still reads `name`.
- **Per-STL profiles, defined once.** Each base design is one entry in `profiles.tsx` declaring its dimensions, content boxes, emboss height, Z convention (`raisedZ: "in"` fills a recess, `"above"` rides on top), flush support, and optional widening. The generator reads it, and the **same entry supplies (or derives) the 2D preview** — so a label type lives in exactly one place, not split across the generator and the preview.
- **Icons are one manifest.** Every clipart symbol and screw-profile image is a single row in `web/src/assets/icons/index.ts`; the SVGs are auto-loaded from that folder via `import.meta.glob`. The pickers, the predefined-label lookups, and the preview all read from it — adding an icon is a file drop plus one row.
- **Raised vs flush.** Raised places the inlay above/into the surface (no CSG). Flush carves the inlay out of the body with manifold-3d so the top is dead-flat; it's only enabled on profiles with `supportsFlush`, and a flush request silently downgrades to raised elsewhere.
- **Everything is lazy.** Three.js + the label builder + the 3MF writer load on first Download; the ~190 kB-gzip manifold wasm loads on first flush. Initial page load stays small (~63 kB gzip).

## Repository layout

```
web/                         React + Vite front-end — this is what gets deployed
  src/
    App.tsx                  Top-level state: base-STL + emboss-mode selectors, preview wiring
    components/
      LabelForm.tsx          "Create your own" form + the icon / line-2-image pickers
      PredefinedSelector.tsx Catalogue tree + export options
      LabelPreview.tsx       Live 2D SVG preview (per-profile layout)
    services/
      labelGenerator.ts      Profile-driven mesh builder (text/SVG → geometry, widening, CSG hook)
      threeMfExporter.ts     Hand-rolled 3MF zip writer (assembly + Bambu config)
      csg.ts                 manifold-3d wrapper for flush mode (lazy)
      profiles.tsx           Profile registry: generation params + 2D preview, Pred + Cullenect (main-chunk, no Three.js)
      api.ts                 Predefined-label catalogue + download orchestration
      pngExporter.ts         Label face → print-ready PNG (black on transparent, lazy)
      layout.ts              Auto-layout when the symbol / line 2 is off (shared by all three renderers)
      placement.ts           Per-element X/Y/size nudges applied on top of the profile defaults
    assets/icons/            SVG clipart + screw-profile images, plus index.ts — the single icon manifest
  public/                    Base STLs, fonts, images served as-is
new_assets/                  Staging area for artwork not yet wired into the app
```

## Extending

For the full developer reference — coordinate systems, the exact 3MF XML, the CSG carve, hot-spots, and gotchas — see [ARCHITECTURE.md](ARCHITECTURE.md).

**Add an icon** — drop the SVG into `web/src/assets/icons/` and add one row to the `DEFS` array in [`web/src/assets/icons/index.ts`](web/src/assets/icons/index.ts):

```ts
{ id: "my-icon", label: "My Icon", file: "my-icon.svg", viewBox: "0 0 100 100", kind: "symbol" },
```

`kind` is `"symbol"` (left clipart picker) or `"line2"` (bottom screw-profile picker). The SVG is auto-loaded from that folder, and the icon then appears in the picker automatically — the UI, the predefined-label lookups, and the preview all read from this one manifest. `viewBox` crops the (often A4-canvas) source SVG down to its drawing region. To put an icon on a predefined label, set that label's `icon` to your new `id` in `web/src/services/api.ts`.

**Add a base STL design** — drop the `.stl` into `web/public/` and add one `BaseStlProfileEntry` to [`web/src/services/profiles.tsx`](web/src/services/profiles.tsx): the generation fields (`contentOrigin`, content boxes, `embossHeight`, `raisedZ`, `supportsFlush`, optional `widening`) plus `previewSize`, then register it in the `PROFILES` map. The 2D preview is derived automatically (content boxes → preview boxes, default rounded-rect outline); add an explicit `preview` override only if the face needs a custom outline or hand-placed boxes, as Pred does for its snap-tab shape.

**Add a predefined label** — append a row to `PREDEFINED_DATA` in `web/src/services/api.ts`.

## Develop & deploy

```bash
cd web
npm install
npm run dev      # http://localhost:5173 — all generation is in-browser, no backend
npm run build    # outputs to web/dist/ (relative base path, GitHub-Pages friendly)
```

Deployment is automatic: pushing to `main` runs `.github/workflows/deploy.yml`, which builds `web/` and publishes `web/dist` to GitHub Pages (also triggerable manually via *Actions → Deploy to GitHub Pages → Run workflow*).

## Credits

A fork of CNC Kitchen's Gridfinity Label Generator. Base label geometry designed by **Pred** ([Printables](https://www.printables.com/model/592545-gridfinity-bin-with-printable-label-by-pred-parame)). Predefined catalogue covers CNC Kitchen fasteners & inserts.
