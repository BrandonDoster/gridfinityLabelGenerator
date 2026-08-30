// Auto-layout for the text lines when the symbol or line 2 is switched off.
//
// Three rules, applied in this order by resolveRects / resolveBoxes:
//   - no symbol            → both lines reclaim the symbol's column, so text is
//                            centred on the whole label instead of hugging the right
//   - no line 2            → line 1 drops to the vertical middle of the content area.
//                            Moved, not resized: the fitted font size is unchanged
//   - no symbol AND no line 2 → line 1 takes the entire content area, so it centres
//                            *and* grows to fill the label
//
// Every rule rewrites the profile's default box before the user's placement nudge
// is applied, so a nudge still reads as "offset from wherever the layout put it".
//
// Self-contained on purpose (no imports), same reason as placement.ts: the
// sibling layout.check.ts runs straight under `node` via native TS
// type-stripping, which can't resolve the extensionless imports the app uses.

/** Y-up rectangle, as used by the 3D content space (services/labelGenerator). */
interface Rect { x1: number; y1: number; x2: number; y2: number; }

/** Y-down box, as used by the 2D preview and the PNG exporter. */
interface Box { x: number; y: number; w: number; h: number; }

/** The three default slots a profile (or the PNG's fixed face) defines. */
interface Slots<T> { iconBox: T; line1Box: T; line2Box: T; }

/** What the label actually renders — drives which layout rules fire. */
interface LabelParts { iconSvg?: string; line2?: string; line2Svg?: string; }

/** True when the label has a second line to render — text or image. */
export function hasLine2(label: LabelParts): boolean {
  return Boolean(label.line2Svg || label.line2?.trim());
}

/** True when the label has a symbol to render in the icon slot. */
export function hasIcon(label: LabelParts): boolean {
  return Boolean(label.iconSvg);
}

/** `a`, shifted so its centre is midway between the centres of `a` and `b`. */
export function centerRect(a: Rect, b: Rect): Rect {
  const dy = (b.y1 + b.y2 - a.y1 - a.y2) / 4;
  return { x1: a.x1, y1: a.y1 + dy, x2: a.x2, y2: a.y2 + dy };
}

/** Same shift in Y-down space. Sign works out identically — both centres flip. */
export function centerBox(a: Box, b: Box): Box {
  return { ...a, y: a.y + (b.y + b.h / 2 - a.y - a.h / 2) / 2 };
}

/** Smallest rect covering both — gives a lone line 1 the full content height. */
function unionRect(a: Rect, b: Rect): Rect {
  return {
    x1: Math.min(a.x1, b.x1),
    y1: Math.min(a.y1, b.y1),
    x2: Math.max(a.x2, b.x2),
    y2: Math.max(a.y2, b.y2),
  };
}

/** Same union in Y-down space. */
function unionBox(a: Box, b: Box): Box {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return {
    x,
    y,
    w: Math.max(a.x + a.w, b.x + b.w) - x,
    h: Math.max(a.y + a.h, b.y + b.h) - y,
  };
}

/** Ink extents of a string: the drawn pixels, not the font's em or advance box. */
export interface Ink { width: number; ascent: number; descent: number; }

/** Measures `text` rendered at `fontSize`. Injected so this file stays testable. */
export type MeasureInk = (text: string, fontSize: number) => Ink;

/** Reference size to measure at. Ink scales linearly, so one measurement does. */
const REF_SIZE = 100;

/**
 * Fit text to a box the way the 3D generator does: scale real ink bounds to the
 * box and centre those bounds in it.
 *
 * The old version guessed instead — width as `maxW * 1.7 / len` (a character
 * count, blind to whether the characters are Ms or 1s) and height as the em
 * size (blind to the font's cap height). Both guesses were masked while the
 * short 4.25 mm slots were height-limited; a full-height box is width-limited,
 * which put the guess on screen. Fonts differ enough to matter here —
 * helvetiker_bold's caps are 1.013 em tall, Arial's 0.716 — so nothing about
 * the metrics is hardcoded; the caller measures whatever font it draws with.
 */
export function fitText(
  text: string,
  box: Box,
  measure: MeasureInk,
): { fontSize: number; baselineY: number } {
  const ref = measure(text, REF_SIZE);
  const inkH = ref.ascent + ref.descent;
  if (ref.width <= 0 || inkH <= 0) return { fontSize: 0, baselineY: box.y + box.h / 2 };

  const fontSize = Math.min((box.w * REF_SIZE) / ref.width, (box.h * REF_SIZE) / inkH);
  const k = fontSize / REF_SIZE;
  // Ink spans [baseline - ascent, baseline + descent]; center that on the box.
  // Not dominant-baseline="central", which centres the font's ascent/descent
  // band and so sits low for the all-caps/digit text these labels carry.
  const baselineY = box.y + box.h / 2 + ((ref.ascent - ref.descent) * k) / 2;
  return { fontSize, baselineY };
}

/**
 * Largest size on the descending grid `start, start-step, start-step*2, …`
 * (stopping at the last value still above `min`) for which `fits` returns
 * true — or `min` when none of them does.
 *
 * `fits` is monotone: if a size fits, every smaller one does. So this
 * binary-searches for the first true instead of walking the grid top-down.
 * The 3D generator's predicate builds a ShapeGeometry — a full earcut
 * triangulation — per probe, and the walk cost ~18 of them on a 4.25 mm slot
 * and 70+ on a full-height box, per line, per label in a batch. The search
 * costs ~6 regardless.
 *
 * The grid is materialised by repeated subtraction rather than
 * `start - k * step` on purpose: the two disagree in the last bits of a float
 * once the error accumulates, and the size this returns must stay identical
 * to what the linear walk it replaced produced. Not a closed-form solve for
 * the same reason — the 0.1 grid, the start value and the floor are all
 * load-bearing for the shipped output.
 */
export function largestFittingSize(
  fits: (size: number) => boolean,
  start: number,
  min: number,
  step: number,
): number {
  const sizes: number[] = [];
  for (let s = start; s > min; s -= step) sizes.push(s);
  // Invariant: everything below `hi` is unprobed-or-fits, everything below
  // `lo` is known not to fit. lo === sizes.length means nothing fit.
  let lo = 0;
  let hi = sizes.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (fits(sizes[mid])) hi = mid;
    else lo = mid + 1;
  }
  return lo < sizes.length ? sizes[lo] : min;
}

/** Resolve the line-1 / line-2 slots for a label, Y-up (3D generation space). */
export function resolveRects(label: LabelParts, slots: Slots<Rect>): { line1: Rect; line2: Rect } {
  const iconX1 = slots.iconBox.x1;
  // No symbol → the lines start where the icon would have, spanning the full width.
  let line1 = hasIcon(label) ? slots.line1Box : { ...slots.line1Box, x1: iconX1 };
  const line2 = hasIcon(label) ? slots.line2Box : { ...slots.line2Box, x1: iconX1 };
  if (!hasLine2(label)) {
    line1 = hasIcon(label) ? centerRect(line1, line2) : unionRect(line1, line2);
  }
  return { line1, line2 };
}

/** Same resolution in Y-down space (2D preview / PNG). Mirrors resolveRects. */
export function resolveBoxes(label: LabelParts, slots: Slots<Box>): { line1: Box; line2: Box } {
  // Widening left means moving x out and growing w by the same amount.
  const widen = (b: Box): Box => ({ ...b, x: slots.iconBox.x, w: b.w + (b.x - slots.iconBox.x) });
  let line1 = hasIcon(label) ? slots.line1Box : widen(slots.line1Box);
  const line2 = hasIcon(label) ? slots.line2Box : widen(slots.line2Box);
  if (!hasLine2(label)) {
    line1 = hasIcon(label) ? centerBox(line1, line2) : unionBox(line1, line2);
  }
  return { line1, line2 };
}
