import type { Ink, MeasureInk } from "./layout";

// Browser text measurement for the two SVG renderers (2D preview, PNG export).
//
// Split out from layout.ts because that file is deliberately import-free and
// runs under plain `node` for layout.check.ts — a canvas doesn't exist there.
// layout.ts takes a MeasureInk instead, and this supplies the real one.

/** Font stack the label text is drawn with. Must match what the SVG requests. */
export const LABEL_FONT = "Arial, 'Helvetica Neue', Helvetica, sans-serif";

let ctx: CanvasRenderingContext2D | null = null;

/**
 * Ink metrics from the canvas `actualBoundingBox*` fields — the drawn pixels,
 * matching how labelGenerator.ts measures extruded glyph bounds. The `width`
 * field would be the advance instead, which overshoots by the side bearings.
 */
export const measureLabelInk: MeasureInk = (text: string, fontSize: number): Ink => {
  ctx ??= document.createElement("canvas").getContext("2d");
  if (!ctx) return { width: 0, ascent: 0, descent: 0 };
  ctx.font = `bold ${fontSize}px ${LABEL_FONT}`;
  const m = ctx.measureText(text);
  return {
    width: m.actualBoundingBoxLeft + m.actualBoundingBoxRight,
    ascent: m.actualBoundingBoxAscent,
    descent: m.actualBoundingBoxDescent,
  };
};
