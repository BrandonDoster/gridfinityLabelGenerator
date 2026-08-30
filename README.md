# Gridfinity Label Generator

**Site: <https://labels.doster.cc>**

Make labels for [Gridfinity](https://gridfinity.xyz/) bins. The generator writes a `.3mf` file for a 3D printer, or a `.png` file for a label printer. It runs in your browser. You install nothing, and there is no server. You can also fork this repository and run your own copy.

Use this if you print Gridfinity bins and you want two-colour fastener labels without opening CAD.

## What it makes

**3MF** — one model with two named parts:

- **Label Body** — the base of the label.
- **Text & Icons** — the letters, the symbol and the line-2 image, merged into one part.

Your slicer shows the two parts as one group. You assign a filament to each part. The parts are pre-assigned to slots 1 and 2, so a multi-colour printer paints them automatically.

**PNG** — the face of the label in black on a transparent background, 36 × 11 mm at 300 DPI. Use it with a label printer such as the Brother P-touch.

## Base designs

Select the base design with the buttons at the top of the **Design** panel.

**Cullenect V2** (default) — a flat label, 36 × 11 mm, from [CullenJWebb/Cullenect-Labels](https://github.com/CullenJWebb/Cullenect-Labels). **Raised** mode puts the text and the symbol on top of the face. **Flush** mode cuts them into the face, so the printed top is flat. Use **Flush** for a smooth two-colour surface.

**Pred** — the [Pred Gridfinity bin label](https://www.printables.com/model/592545-gridfinity-bin-with-printable-label-by-pred-parame), 37.8 × 11.5 mm, with snap tabs and a recessed top. The text and the symbol fill the recess, so the printed inlay is level with the outer edge. This design has widths of 1×, 2× and 3×. It is raised only, so the **Raised** / **Flush** buttons do not show.

## Parts of a label

- **Symbol** (left) — a clipart symbol: a drive type (hex, Torx, Phillips, slot, Robertson) or a part (nut, nylock, washer, large washer, lock washer, insert, square nut, T-nut, roll-in T-nut). You can set the symbol to **Off**.
- **Line 1** (top right) — your text. The generator sets the text size to fill the box.
- **Line 2** (bottom right) — your text, or one of 8 screw-profile images. You can set line 2 to **Off**.

If you set the symbol or line 2 to **Off**, the remaining parts get the free space.

Each element has **X**, **Y** and **Size** fields, in millimetres. Use them to move or resize that element. Press **Reset** for the default position.

## How to use it

1. Type your text in **Line 1**. Select **Image**, **Text** or **Off** for **Line 2**.
2. Select a symbol, or set **Symbol** to **Off**.
3. Select the base design, and the emboss mode if the design offers one.
4. Press **Download 3MF** or **Download PNG**.

The preview shows your label as you type.

The **Fastener Sizes** panel exports a length range with one press. Select a diameter (M2 to M6). The generator makes 15 labels, from 4 mm to 50 mm, and downloads them as one `.zip`. The labels copy the design in the **Design** panel, and only line 1 changes.

## Printing

- **Layer height** — 0.2 mm. The emboss depth is 0.4 mm, which is two layers.
- **Wall generator** — Arachne gives sharper detail on thin strokes.
- **Multi-colour (AMS / MMU)** — load the body filament in slot 1 and the text filament in slot 2. The slicer assigns the colours from the file. Put the two filaments on separate AMS slots; do not print both parts from one slot.
- **Single filament** — set a colour change at **layer 3**. The embossed text then prints in the second colour.

### macOS

Apple Gatekeeper can show a "could not verify" message for a `.3mf` file instead of opening your slicer. To correct this, set your slicer as the default program for `.3mf` files: right-click any `.3mf` file, select **Get Info**, set **Open with** to your slicer, then press **Change All…**.

## Run it locally

```bash
cd web
npm install
npm run dev      # http://localhost:5173
```

Before you send a change, run all three:

```bash
npm run check    # placement + layout self-checks, plain node
npm test         # Vitest suite
npm run build    # writes web/dist/
```

A push to `main` runs `.github/workflows/deploy.yml`, which builds `web/` and publishes `web/dist` to GitHub Pages.

## Add an icon

1. Put your SVG in `web/src/assets/icons/`.
2. Add one row to the `DEFS` array in [`web/src/assets/icons/index.ts`](web/src/assets/icons/index.ts):

```ts
{ id: "my-icon", label: "My Icon", file: "my-icon.svg", viewBox: "0 0 100 100", kind: "symbol" },
```

3. Run `npm run dev` and check that the icon fills its box in the preview.

Set `kind` to `"symbol"` for the left symbol picker, or `"line2"` for the screw-profile picker. `viewBox` crops the source SVG to the drawing. Many source SVGs use a full A4 canvas, so the crop matters. You edit no other file: the pickers, the preview and both exporters read this one list.

## Contribute

Open an [issue](https://github.com/BrandonDoster/gridfinityLabelGenerator/issues) for a bug or a request. For code, read [ARCHITECTURE.md](ARCHITECTURE.md) first — it covers the pipeline, the coordinate systems, the 3MF structure and the gotchas.

## Credits

A fork of the CNC Kitchen Gridfinity Label Generator, MIT licensed. **Pred** designed the Pred base label ([Printables](https://www.printables.com/model/592545-gridfinity-bin-with-printable-label-by-pred-parame)). **CullenJWebb** designed the [Cullenect](https://github.com/CullenJWebb/Cullenect-Labels) label.
