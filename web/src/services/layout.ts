// Line-1 placement when line 2 is switched off.
//
// With no second line the label reads better if the one remaining line sits on
// the vertical middle of the content area rather than staying in the top slot.
// "Middle" is the midpoint between the two normal line boxes' centres — line 1
// is moved, not resized, so the fitted font size is unchanged.
//
// Self-contained on purpose (no imports), same reason as iconAdjust.ts: the
// sibling layout.check.ts runs straight under `node` via native TS
// type-stripping, which can't resolve the extensionless imports the app uses.

/** Y-up rectangle, as used by the 3D content space (services/labelGenerator). */
interface Rect { x1: number; y1: number; x2: number; y2: number; }

/** Y-down box, as used by the 2D preview and the PNG exporter. */
interface Box { x: number; y: number; w: number; h: number; }

/** True when the label has a second line to render — text or image. */
export function hasLine2(label: { line2?: string; line2Svg?: string }): boolean {
  return Boolean(label.line2Svg || label.line2?.trim());
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
