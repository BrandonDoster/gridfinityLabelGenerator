// Self-check for the line-1 centring math. No test framework: run it with
//   node src/services/layout.check.ts
// (Node >= 22.6 strips the types natively.)

import assert from "node:assert/strict";
import {
  centerBox,
  centerRect,
  fitText,
  hasIcon,
  hasLine2,
  largestFittingSize,
  resolveBoxes,
  resolveRects,
  type MeasureInk,
} from "./layout.ts";

const ICON  = { x1: 1.5, y1: 0.5, x2: 11, y2: 10 };     // Pred/Cullenect iconBox
const LINE1 = { x1: 11, y1: 5.75, x2: 34.5, y2: 10 };   // Pred/Cullenect line1Box
const LINE2 = { x1: 11, y1: 0.5, x2: 34.5, y2: 4.75 };  // Pred/Cullenect line2Box
const FACE_H = 11.5;                                     // Pred face height (mm)

// Mirrors derivePreviewBox() in services/profiles.tsx: Y-up rect -> Y-down box.
const toBox = (r: typeof LINE1) => ({ x: r.x1, y: FACE_H - r.y2, w: r.x2 - r.x1, h: r.y2 - r.y1 });

// 1. A line 2 is anything renderable — text or image. Whitespace is not text.
assert.equal(hasLine2({ line2: "Screw" }), true);
assert.equal(hasLine2({ line2: "" }), false);
assert.equal(hasLine2({ line2: "   " }), false);
assert.equal(hasLine2({ line2: "", line2Svg: "<svg/>" }), true);

// 2. The box moves but never resizes — the fitted font size must not change.
const centred = centerRect(LINE1, LINE2);
assert.equal(centred.x1, LINE1.x1);
assert.equal(centred.x2, LINE1.x2);
assert.equal(centred.y2 - centred.y1, LINE1.y2 - LINE1.y1);

// 3. Its centre is the midpoint of the two boxes' centres, i.e. the middle of
//    the content area (5.25 mm here, not the raw 5.75 mm face middle — the
//    content band is inset from the face edges).
assert.equal((centred.y1 + centred.y2) / 2, 5.25);

// 4. The spaces agree: centring then projecting to preview space must equal
//    projecting then centring. This is what catches a sign flip between the
//    Y-up generator and the Y-down preview/PNG.
assert.deepEqual(centerBox(toBox(LINE1), toBox(LINE2)), toBox(centred));

// 5. Idempotent in the degenerate case: centring a box against itself is a no-op.
assert.deepEqual(centerRect(LINE1, LINE1), LINE1);

// ── Symbol on/off auto-layout ──────────────────────────────────────────────

const SLOTS = { iconBox: ICON, line1Box: LINE1, line2Box: LINE2 };
const SLOT_BOXES = { iconBox: toBox(ICON), line1Box: toBox(LINE1), line2Box: toBox(LINE2) };

// 6. A symbol is an icon SVG, and only a non-empty one.
assert.equal(hasIcon({ iconSvg: "<svg/>" }), true);
assert.equal(hasIcon({ iconSvg: "" }), false);
assert.equal(hasIcon({}), false);

// 7. Symbol on + line 2 on: both slots are the profile defaults, untouched.
const bothOn = resolveRects({ iconSvg: "<svg/>", line2: "Screw" }, SLOTS);
assert.deepEqual(bothOn.line1, LINE1);
assert.deepEqual(bothOn.line2, LINE2);

// 8. Symbol off: both lines reclaim the icon column — left edge only, so the
//    vertical slots and therefore the two-line stack are unchanged.
const noIcon = resolveRects({ line2: "Screw" }, SLOTS);
assert.deepEqual(noIcon.line1, { ...LINE1, x1: ICON.x1 });
assert.deepEqual(noIcon.line2, { ...LINE2, x1: ICON.x1 });

// 9. Symbol on + line 2 off: the existing behaviour survives — line 1 centres
//    vertically at the same size, and does NOT widen into the icon column.
const noLine2 = resolveRects({ iconSvg: "<svg/>", line2: "" }, SLOTS);
assert.deepEqual(noLine2.line1, centerRect(LINE1, LINE2));
assert.equal(noLine2.line1.x1, LINE1.x1);

// 10. Both off: line 1 takes the whole content area, so it centres and grows.
const neither = resolveRects({ line2: "" }, SLOTS);
assert.deepEqual(neither.line1, { x1: ICON.x1, y1: LINE2.y1, x2: LINE1.x2, y2: LINE1.y2 });
assert.ok(neither.line1.y2 - neither.line1.y1 > LINE1.y2 - LINE1.y1, "line 1 must grow taller");
assert.ok(neither.line1.x2 - neither.line1.x1 > LINE1.x2 - LINE1.x1, "line 1 must grow wider");

// 11. The spaces agree for every combination: resolving then projecting to
//     preview space must equal projecting then resolving. Catches a sign flip or
//     a bad width calc between the Y-up generator and the Y-down preview/PNG.
for (const iconSvg of ["<svg/>", ""]) {
  for (const line2 of ["Screw", ""]) {
    const label = { iconSvg, line2 };
    const rects = resolveRects(label, SLOTS);
    const boxes = resolveBoxes(label, SLOT_BOXES);
    assert.deepEqual(boxes.line1, toBox(rects.line1), `line1 mismatch: ${iconSvg}/${line2}`);
    assert.deepEqual(boxes.line2, toBox(rects.line2), `line2 mismatch: ${iconSvg}/${line2}`);
  }
}

// ── Ink-based text fitting (preview / PNG must match the 3D generator) ─────

// Stand-in for a real font: ink 0.6 em wide per character, caps 0.72 em tall
// with no descender. Arbitrary but fixed — these assertions are about the
// fitting maths, not about any particular font's metrics.
const CHAR_W = 0.6;
const CAP = 0.72;
const fakeFont: MeasureInk = (text, fontSize) => ({
  width: text.length * CHAR_W * fontSize,
  ascent: CAP * fontSize,
  descent: 0,
});

// Ink of `text` at `fontSize`, per the same fake font.
const inkOf = (text: string, fontSize: number) => ({
  w: text.length * CHAR_W * fontSize,
  h: CAP * fontSize,
});

// 12. A wide, short box is height-limited: the ink fills the height exactly and
//     stays inside the width.
const wide = { x: 0, y: 1, w: 100, h: 4.25 };
const wideFit = fitText("M3x10", wide, fakeFont);
assert.ok(Math.abs(inkOf("M3x10", wideFit.fontSize).h - wide.h) < 1e-9, "ink must fill height");
assert.ok(inkOf("M3x10", wideFit.fontSize).w <= wide.w + 1e-9, "must stay inside width");

// 13. A narrow, tall box is width-limited — the case that put the old
//     character-count guess on screen once the box grew to full height.
const tall = { x: 0, y: 1, w: 33, h: 9.5 };
const tallFit = fitText("M3x10", tall, fakeFont);
assert.ok(Math.abs(inkOf("M3x10", tallFit.fontSize).w - tall.w) < 1e-9, "ink must fill width");
assert.ok(inkOf("M3x10", tallFit.fontSize).h <= tall.h + 1e-9, "must stay inside height");

// 14. Ink never escapes the box, for either limit, at any of the real slot sizes.
for (const b of [tall, wide, { x: 0, y: 6.25, w: 23.5, h: 4.25 }]) {
  for (const t of ["M", "M3x10", "WWWWWWWWWW"]) {
    const { fontSize } = fitText(t, b, fakeFont);
    const ink = inkOf(t, fontSize);
    assert.ok(ink.w <= b.w + 1e-9 && ink.h <= b.h + 1e-9, `ink overflows: "${t}"`);
  }
}

// 15. The ink is vertically centred: equal margins above and below. This is the
//     regression that made a full-height line 1 sit low in the preview.
for (const b of [tall, wide]) {
  const { fontSize, baselineY } = fitText("M3x10", b, fakeFont);
  const above = baselineY - inkOf("M3x10", fontSize).h - b.y; // descent is 0 here
  const below = b.y + b.h - baselineY;
  assert.ok(Math.abs(above - below) < 1e-9, "ink margins above and below must be equal");
}

// 16. Width scales with the actual characters, not the character count — the
//     specific blind spot of the old `maxW * 1.7 / len` guess.
const narrowChars: MeasureInk = (text, fontSize) => ({
  width: text.length * 0.2 * fontSize,
  ascent: CAP * fontSize,
  descent: 0,
});
assert.ok(
  fitText("11111", tall, narrowChars).fontSize > fitText("11111", tall, fakeFont).fontSize,
  "narrower glyphs must permit a larger size at the same character count",
);

// 17. Degenerate input can't produce NaN geometry.
const empty = fitText("", tall, () => ({ width: 0, ascent: 0, descent: 0 }));
assert.equal(empty.fontSize, 0);
assert.ok(Number.isFinite(empty.baselineY));

// ── Fitted-size search (must match the linear walk it replaced, exactly) ───

// The walk largestFittingSize replaced, verbatim. The binary search is only
// allowed to be faster, never to land on a different float — a mismatch here
// means every exported label changes size.
function linearScan(
  fits: (size: number) => boolean,
  start: number,
  min: number,
  step: number,
): number {
  for (let s = start; s > min; s -= step) if (fits(s)) return s;
  return min;
}

// The generator's real arguments (min 1.2, step 0.1) plus the two start values
// it actually produces — 6 for a standard 4.25 mm slot, 13.3 for a full-height
// box — and the degenerate start-at-or-below-the-floor case.
const MIN = 1.2;
const STEP = 0.1;
for (const start of [6, 5.95, 13.3, 1.3, 1.2, 0.5]) {
  // Every grid point as a threshold, so "fits immediately at the start size"
  // and "fits only at the floor" are both in here, plus the two extremes:
  // Infinity fits everywhere, -Infinity fits nowhere (falls back to min).
  const thresholds = [Infinity, -Infinity];
  for (let s = start; s > MIN; s -= STEP) thresholds.push(s);
  for (const threshold of thresholds) {
    const fits = (s: number) => s <= threshold; // monotone, as the real one is
    assert.equal(
      largestFittingSize(fits, start, MIN, STEP),
      linearScan(fits, start, MIN, STEP),
      `search disagrees with the walk: start=${start} threshold=${threshold}`,
    );
  }
}

// 19. The search is a search, not a walk: probes must stay logarithmic in the
//     grid size, or the triangulation cost this was written to cut is back.
let probes = 0;
largestFittingSize((s) => { probes++; return s <= 2; }, 13.3, MIN, STEP);
assert.ok(probes <= 8, `expected a binary search, got ${probes} probes`);

console.log("layout: ok");
