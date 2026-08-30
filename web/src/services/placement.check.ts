// Self-check for the placement-nudge math. No test framework: run it directly with
//   node src/services/placement.check.ts
// (Node >= 22.6 strips the types natively.)

import assert from "node:assert/strict";
import { DEFAULT_PLACEMENT, adjustBox, adjustRect } from "./placement.ts";

const RECT = { x1: 1.5, y1: 0.5, x2: 11, y2: 10 };   // Pred/Cullenect iconBox
const FACE_H = 11.5;                                  // Pred face height (mm)

// Mirrors derivePreviewBox() in services/profiles.tsx: Y-up rect -> Y-down box.
const toBox = (r: typeof RECT) => ({ x: r.x1, y: FACE_H - r.y2, w: r.x2 - r.x1, h: r.y2 - r.y1 });

// 1. Default is the identity in both spaces — existing labels must not move.
assert.deepEqual(adjustRect(RECT, DEFAULT_PLACEMENT), RECT);
assert.deepEqual(adjustRect(RECT), RECT);
assert.deepEqual(adjustBox(toBox(RECT)), toBox(RECT));

// 2. Scale grows about the centre: centre fixed, size multiplied.
const scaled = adjustRect(RECT, { dx: 0, dy: 0, scale: 2 });
assert.equal((scaled.x1 + scaled.x2) / 2, (RECT.x1 + RECT.x2) / 2);
assert.equal((scaled.y1 + scaled.y2) / 2, (RECT.y1 + RECT.y2) / 2);
assert.equal(scaled.x2 - scaled.x1, (RECT.x2 - RECT.x1) * 2);
assert.equal(scaled.y2 - scaled.y1, (RECT.y2 - RECT.y1) * 2);

// 3. Translation moves without resizing.
const moved = adjustRect(RECT, { dx: 2, dy: -1, scale: 1 });
assert.deepEqual(moved, { x1: 3.5, y1: -0.5, x2: 13, y2: 9 });

// 4. The spaces agree: nudging then projecting to preview space must equal
//    projecting then nudging. This is what catches a dy sign flip between the
//    Y-up generator and the Y-down preview/PNG. Compared with a tolerance —
//    the two orders reassociate the same floats differently.
const near = (a: number, b: number, what: string) =>
  assert.ok(Math.abs(a - b) < 1e-9, `${what}: ${a} != ${b}`);

for (const a of [
  { dx: 0, dy: 0, scale: 1 },
  { dx: 1.25, dy: 0.75, scale: 1 },
  { dx: -2, dy: -1.5, scale: 1.4 },
  { dx: 0.5, dy: -3, scale: 0.6 },
]) {
  const viaBox = adjustBox(toBox(RECT), a);
  const viaRect = toBox(adjustRect(RECT, a));
  for (const k of ["x", "y", "w", "h"] as const) near(viaBox[k], viaRect[k], `${JSON.stringify(a)} ${k}`);
}

// 5. A typed-in scale of 0, a negative, or NaN must never reach the geometry:
//    0 collapses the extruded mesh to a point and a negative mirrors it, which
//    inverts triangle winding (non-manifold 3MF, CSG failure in flush mode).
for (const scale of [0, -1, Number.NaN]) {
  const r = adjustRect(RECT, { dx: 0, dy: 0, scale });
  const b = adjustBox(toBox(RECT), { dx: 0, dy: 0, scale });
  assert.ok(r.x2 > r.x1 && r.y2 > r.y1, `rect must stay positive-area at scale ${scale}`);
  assert.ok(b.w > 0 && b.h > 0, `box must stay positive-area at scale ${scale}`);
}

console.log("placement: ok");
