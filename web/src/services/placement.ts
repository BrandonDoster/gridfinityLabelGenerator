// Placement nudge: a delta applied on top of the active profile's default box
// for an element, rather than an absolute rectangle. Deltas are profile-agnostic,
// so switching base STL keeps an element in the same relative spot even though
// Pred and Cullenect resolve their preview boxes differently.
//
// Self-contained on purpose (no imports): the sibling placement.check.ts runs
// straight under `node` via native TS type-stripping, which can't resolve the
// extensionless imports the rest of the app uses.

export interface Placement {
  /** Horizontal shift (mm). Positive moves right in every space. */
  dx: number;
  /** Vertical shift (mm), world convention: positive moves UP the label face. */
  dy: number;
  /** Multiplies the box about its centre. 1 = profile default. */
  scale: number;
}

export const DEFAULT_PLACEMENT: Placement = { dx: 0, dy: 0, scale: 1 };

/** One nudge per positionable element on the label face. */
export interface Placements {
  icon: Placement;
  line1: Placement;
  line2: Placement;
}

export const DEFAULT_PLACEMENTS: Placements = {
  icon: DEFAULT_PLACEMENT,
  line1: DEFAULT_PLACEMENT,
  line2: DEFAULT_PLACEMENT,
};

/** True when this nudge is the profile default, i.e. changes nothing. */
export function isDefault(p: Placement): boolean {
  return p.dx === 0 && p.dy === 0 && p.scale === 1;
}

/** Y-up rectangle, as used by the 3D content space (services/labelGenerator). */
interface Rect { x1: number; y1: number; x2: number; y2: number; }

/** Y-down box, as used by the 2D preview and the PNG exporter. */
interface Box { x: number; y: number; w: number; h: number; }

/** Apply a nudge to a Y-up content rectangle (3D generation space). */
export function adjustRect(box: Rect, a: Placement = DEFAULT_PLACEMENT): Rect {
  const gx = ((box.x2 - box.x1) * (a.scale - 1)) / 2;
  const gy = ((box.y2 - box.y1) * (a.scale - 1)) / 2;
  return {
    x1: box.x1 - gx + a.dx,
    y1: box.y1 - gy + a.dy,
    x2: box.x2 + gx + a.dx,
    y2: box.y2 + gy + a.dy,
  };
}

/** Apply a nudge to a Y-down box (2D preview / PNG space) — dy sign flips. */
export function adjustBox(box: Box, a: Placement = DEFAULT_PLACEMENT): Box {
  return {
    x: box.x - (box.w * (a.scale - 1)) / 2 + a.dx,
    y: box.y - (box.h * (a.scale - 1)) / 2 - a.dy,
    w: box.w * a.scale,
    h: box.h * a.scale,
  };
}
