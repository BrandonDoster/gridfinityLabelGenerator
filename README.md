# Gridfinity Label Generator

**Web generator: https://cnckitchen.github.io/gridfinityLabelGenerator/**

A browser-based tool that generates custom **3MF labels** for [Gridfinity bins](https://www.printables.com/model/592545-gridfinity-bin-with-printable-label-by-pred-parame). Everything runs entirely in the browser — no server or install required for the deployed version.

## What it does

The generator composites a base label STL with embossed text and clipart icons, then exports the result as a multi-part `.3mf` file ready to slice. Each export contains two named parts:

- **Label Body** — the base structure of the label
- **Text & Icons** — every letter, the icon, and the optional line-2 image, merged into one paintable inlay

The slicer shows these as a single grouped model with two paintable children. For multi-color printers (Bambu AMS / Prusa MMU / OrcaSlicer multi-tool), the parts are pre-assigned to filament slots 1 and 2 so the body and inlay auto-paint with whatever colors are loaded. Single-filament printers print the whole label in slot 1 — the color-change-at-layer-3 workflow described under [Printing tips](#printing-tips) still applies.

Each label consists of:

- **Icon** (left side): one of 10 clipart symbols (hex, nut, nylock, washer, large washer, lock washer, insert, torx, phillips, slot)
- **Line 1** (top right): text, auto-sized to fill the available box
- **Line 2** (bottom right): text, or one of 10 technical screw-profile images (button head, countersunk, cylinder head, grub screw, hex head, low head, pan head, and self-tapping variants)
- **Emboss depth**: 0.4 mm — two layers at 0.2 mm layer height, prints solidly with a clean color change

## Base STL designs

The generator supports two base label designs, selectable in the **Base STL** toggle at the top of the page:

### Pred Gridfinity (default)
The original [Pred-designed Gridfinity bin label STL](https://www.printables.com/model/592545-gridfinity-bin-with-printable-label-by-pred-parame), 37.8×11.5 mm with snap tabs and a recessed interior. Text and icons fill the recess; the printed result has the inlay coplanar with the outer perimeter. Supports 1× / 2× / 3× widths.

### Cullenect V2
A 36×11 mm flat-bodied alternative, 1U wide. Text and icons either ride on top of the flat surface (**Raised** mode) or are CSG-carved into the body so the print is dead-flat (**Flush** mode). Flush mode is ideal for multi-material printing where you want a smooth top surface with color regions instead of physical relief.

The Emboss Mode toggle appears only when Cullenect is selected; Pred is raised-only.

## Modes

### Custom label
Enter your own text and pick an icon. Exports a single `.3mf`.

### Predefined labels
Select from a curated catalogue of CNC Kitchen fasteners and inserts. Exporting one label gives a `.3mf`; exporting multiple gives a `.zip` with one `.3mf` file per label.

**Categories:**

- **Heat inserts** — metric (M2–M10) and imperial (#2-56–3/8″-16), various lengths
- **Socket head cap screws** — M1.6–M5, lengths from 3–45 mm, each labelled with its Torx drive size (TX5–TX25)
- **Hex nuts** — M2–M8
- **Nylock nuts** — M2–M8
- **Standard washers** — M2–M8
- **Large washers** — M2–M8

## Printing tips

- **Layer height**: 0.2 mm
- **Wall generator**: Arachne recommended for sharper detail on thin strokes
- **Multi-color (AMS / MMU)**: just load filaments into slots 1 (body) and 2 (text/icons); the slicer will auto-paint.
- **Single-filament with color change**: set a color change at **layer 3** so the embossed text prints in a contrasting colour.

### macOS users

If `.3mf` files open Apple's Gatekeeper "could not verify" prompt instead of your slicer on double-click, set OrcaSlicer (or your slicer of choice) as the default `.3mf` handler:

1. Right-click any `.3mf` file in Finder
2. Get Info → "Open with: OrcaSlicer"
3. Click "Change All…"

Future `.3mf` downloads then route straight to the slicer without Gatekeeper interception.

## How it works

3MF generation runs entirely in the browser using [Three.js](https://threejs.org/) for mesh work, [fflate](https://github.com/101arrowz/fflate) for the 3MF zip, and (in Cullenect flush mode only) [manifold-3d](https://github.com/elalish/manifold) for the CSG carve:

1. Loads the selected base STL (`GridfinityBinLabel.stl` or `CullenectBinLabel.stl`) as the base body geometry.
2. Parses SVG clipart with `SVGLoader`, extrudes to 3D, and scales it into the icon box.
3. Generates font glyphs from `helvetiker_bold.typeface.json` using a custom tracking function (tighter letter spacing → larger font size → thicker strokes → more slicer-friendly).
4. Extrudes all text and icon shapes to 0.4 mm depth and positions them on the label surface per the active profile's emboss mode.
5. **Cullenect Flush only**: lazy-loads manifold-3d's wasm and subtracts the inlay shape from the base mesh so both parts end up individually manifold with a flat top.
6. Merges the inlay shapes (line 1 + line 2 + icon) into a single indexed BufferGeometry — disconnected triangle islands inside one mesh so the slicer treats the whole inlay as one paintable child.
7. Hand-rolls the 3MF zip: `[Content_Types].xml`, `_rels/.rels`, `3D/3dmodel.model` with a `<components>` assembly, and `Metadata/model_settings.config` with Bambu/Orca-style part names and `extruder` slot assignments.
8. For 2× or 3× wide Pred labels, widens the base geometry by shifting vertices right of the geometric midpoint and centres the content accordingly.

The generator pipeline (Three.js + the label-builder + the 3MF exporter) is code-split into a lazy chunk that only fetches on first Download click. The manifold-3d wasm is a second lazy chunk that only fetches on first flush export. Users who never click Download don't pay either cost.

## Project structure

```
web/      React + Vite front-end — this is what gets deployed
server/   Legacy Express prototype with server-side STL generation (not maintained, not used by the deployed site)
```

## Run locally

```bash
cd web
npm install
npm run dev
```

Opens at `http://localhost:5173`. No backend needed — all generation happens in-browser.

## Build

```bash
cd web
npm run build
```

Output goes to `web/dist/`. The `base: "./"` setting in `vite.config.ts` ensures assets use relative paths, so the build works on GitHub Pages and any subdirectory host. The build emits multiple chunks; the manifold-3d wasm and JS only fetch on demand when a user selects Cullenect + Flush.
