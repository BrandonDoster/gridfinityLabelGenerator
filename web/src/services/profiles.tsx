import type { BaseStlProfile, BaseStlProfileId, ContentRect } from "../types/label";

// Single source of truth for every base STL design — both the 3D generation
// parameters (read by services/labelGenerator.ts) and the 2D preview face
// (read by components/LabelPreview.tsx). Defining a new base STL means adding
// ONE entry here and dropping its .stl into web/public/.
//
// Kept free of Three.js / fflate so it stays in the main chunk and doesn't drag
// the generator pipeline into the initial page load (JSX/React is already there).

// ── 2D preview types ──────────────────────────────────────────────────────
// Preview coordinate space: (0,0) top-left, Y down. Boxes are pre-flipped from
// the 3D world (where Y grows up), so line 1 sits at the top with the smaller Y.

export interface PreviewBox { x: number; y: number; w: number; h: number; }

export interface PreviewLayout {
  width: number;          // visible label face width (mm)
  height: number;         // visible label face height (mm)
  vbMargin: number;       // viewBox padding so the outline stroke isn't clipped
  iconBox: PreviewBox;
  line1Box: PreviewBox;
  line2Box: PreviewBox;
  renderOutline: () => JSX.Element;
}

// A registry entry: the generation profile plus its 2D-preview face.
export interface BaseStlProfileEntry extends BaseStlProfile {
  /** Visible label-face size (mm) used by the 2D preview. */
  previewSize: { width: number; height: number };
  /**
   * Explicit 2D-preview overrides. Omit any field to derive it: content boxes
   * become preview boxes via a Y-flip, and the outline defaults to a rounded
   * rectangle of previewSize. A clean origin-anchored face (e.g. Cullenect)
   * needs no overrides; Pred overrides everything because its snap-tab outline
   * doesn't map 1:1 from the content boxes.
   */
  preview?: {
    vbMargin?: number;
    iconBox?: PreviewBox;
    line1Box?: PreviewBox;
    line2Box?: PreviewBox;
    renderOutline?: () => JSX.Element;
  };
}

// Pred outline — complex shape extracted from label.svg (Inkscape DXF export,
// 96 dpi). The transform maps local px → overlay mm (0..37.8 × 0..11.5).
const PRED_LABEL_TRANSFORM = "scale(0.264583) translate(137.19, -1120.59)";

/**
 * Pred Gridfinity label — original base STL, recessed interior with a raised
 * perimeter / snap-tabs. Inlay fills the recess (raisedZ: "in"). 1U/2U/3U
 * widening via the geometric-midpoint vertex shift.
 */
export const PRED_PROFILE: BaseStlProfileEntry = {
  id: "pred",
  displayName: "Pred",
  assetPath: "GridfinityBinLabel.stl",
  contentOrigin: { x: 1.5, y: 0.5 },
  iconBox: { x1: 1.5, y1: 0.5, x2: 11, y2: 10 },
  line1Box: { x1: 11, y1: 5.75, x2: 34.5, y2: 10 },
  line2Box: { x1: 11, y1: 0.5, x2: 34.5, y2: 4.75 },
  embossHeight: 0.4,
  raisedZ: "in",
  supportsFlush: false,
  widening: { extraWidthPerUnit: 42 },
  previewSize: { width: 37.8, height: 11.5 },
  preview: {
    // Hand-tuned to the snap-tab outline below — not derivable from content boxes.
    iconBox:  { x: 3.0,  y: 1.0,  w: 9.5,  h: 9.5 },
    line1Box: { x: 13.5, y: 1.0,  w: 21.3, h: 4.25 },
    line2Box: { x: 13.5, y: 6.25, w: 21.3, h: 4.25 },
    renderOutline: () => (
      <g transform={PRED_LABEL_TRANSFORM} strokeLinecap="round" strokeLinejoin="round">
        {/* Outer body (main rectangle + side tabs) */}
        <path
          d="M 5.669669,1131.5528 H 1.889764 v -7.5591 a 3.401575,3.401575 0 0 0 -3.401575,-3.4016 H -130.01575 a 3.401575,3.401575 0 0 0 -3.40157,3.4016 v 7.5591 h -3.77991 v 21.5433 h 3.77991 v 7.559 a 3.401575,3.401575 0 0 0 3.40157,3.4016 H -1.511811 a 3.401575,3.401575 0 0 0 3.401575,-3.4016 v -7.559 h 3.779905 z"
          fill="var(--label-body)"
          stroke="var(--label-edge)"
          strokeWidth="1.89"
        />
        {/* Inner printed area */}
        <path
          d="m -130.01575,1122.4819 a 1.511811,1.511811 0 0 0 -1.51181,1.5118 v 10.7128 a 3.779528,3.779528 0 0 0 2.09974,3.3858 4.724409,4.724409 0 0 1 0,8.4643 3.779528,3.779528 0 0 0 -2.09974,3.3857 v 10.7128 a 1.511811,1.511811 0 0 0 1.51181,1.5118 H -1.511811 A 1.511811,1.511811 0 0 0 0,1160.6551 v -10.7128 a 3.779528,3.779528 0 0 0 -2.099738,-3.3857 4.724409,4.724409 0 0 1 0,-8.4643 A 3.779528,3.779528 0 0 0 0,1134.7065 v -10.7128 a 1.511811,1.511811 0 0 0 -1.511811,-1.5118 z"
          fill="var(--label-face)"
          stroke="none"
        />
        {/* Left mounting pin */}
        <path
          d="m -128.69291,1142.3244 a 2.834646,2.834646 0 0 0 -5.66929,0 2.834646,2.834646 0 0 0 5.66929,0 z"
          fill="none"
          stroke="var(--label-edge)"
          strokeWidth="1.89"
        />
        {/* Right mounting pin */}
        <path
          d="m 2.834646,1142.3244 a 2.834646,2.834646 0 0 0 -5.669292,0 2.834646,2.834646 0 0 0 5.669292,0 z"
          fill="none"
          stroke="var(--label-edge)"
          strokeWidth="1.89"
        />
      </g>
    ),
  },
};

/**
 * Cullenect V2 label — 36×11×1.2 mm flat-bodied design. Inlay rides on top of
 * the body (raisedZ: "above"); supports CSG flush mode. Content boxes match
 * Pred for "equal value" output across STLs. The preview needs no overrides:
 * its boxes derive from the content boxes and its outline is the default
 * rounded rectangle.
 */
export const CULLENECT_PROFILE: BaseStlProfileEntry = {
  id: "cullenect",
  displayName: "Cullenect V2",
  assetPath: "CullenectBinLabel.stl",
  contentOrigin: { x: 0, y: 0 },
  iconBox: { x1: 1.5, y1: 0.5, x2: 11, y2: 10 },
  line1Box: { x1: 11, y1: 5.75, x2: 34.5, y2: 10 },
  line2Box: { x1: 11, y1: 0.5, x2: 34.5, y2: 4.75 },
  // 0.4 mm = 2 layers at 0.2 mm — single-layer color changes print unreliably.
  embossHeight: 0.4,
  raisedZ: "above",
  supportsFlush: true,
  previewSize: { width: 36, height: 11 },
};

const PROFILES: Record<BaseStlProfileId, BaseStlProfileEntry> = {
  pred: PRED_PROFILE,
  cullenect: CULLENECT_PROFILE,
};

/** Selected on load, and the fallback for an unknown id. */
export const DEFAULT_PROFILE_ID: BaseStlProfileId = "cullenect";

/** Resolve a profile by id; falls back to the default for unknown / undefined ids. */
export function getProfile(id: BaseStlProfileId | undefined): BaseStlProfileEntry {
  return PROFILES[id ?? DEFAULT_PROFILE_ID] ?? PROFILES[DEFAULT_PROFILE_ID];
}

/** Profile catalog for UI selectors. Stable order: the default first. */
export function listProfiles(): BaseStlProfileEntry[] {
  return [PROFILES.cullenect, PROFILES.pred];
}

// Content boxes are mm with Y up; the preview SVG is Y-down from the top edge.
function derivePreviewBox(box: ContentRect, faceHeight: number): PreviewBox {
  return { x: box.x1, y: faceHeight - box.y2, w: box.x2 - box.x1, h: box.y2 - box.y1 };
}

/** Resolve a profile's 2D-preview layout, deriving any field not overridden. */
export function getPreviewLayout(profile: BaseStlProfileEntry): PreviewLayout {
  const { width, height } = profile.previewSize;
  const o = profile.preview;
  return {
    width,
    height,
    vbMargin: o?.vbMargin ?? 1,
    iconBox: o?.iconBox ?? derivePreviewBox(profile.iconBox, height),
    line1Box: o?.line1Box ?? derivePreviewBox(profile.line1Box, height),
    line2Box: o?.line2Box ?? derivePreviewBox(profile.line2Box, height),
    renderOutline:
      o?.renderOutline ??
      (() => (
        <rect
          x={0}
          y={0}
          width={width}
          height={height}
          rx={0.5}
          ry={0.5}
          fill="var(--label-face)"
          stroke="var(--label-edge)"
          strokeWidth={0.3}
        />
      )),
  };
}
