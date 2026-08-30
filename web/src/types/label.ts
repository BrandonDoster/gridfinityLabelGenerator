import type { Placements } from "../services/placement";

export type { Placements };

export interface LabelInput {
  id?: string;
  title: string;
  line1: string;
  line2: string;
  iconSvg: string;
  iconViewBox?: string;  // viewBox crop for iconSvg (A4-canvas SVGs need cropping)
  line2Svg?: string;    // SVG to render in the line-2 box instead of text
  line2ViewBox?: string; // viewBox crop for line2Svg (A4-canvas SVGs need cropping)
  labelWidth?: 1 | 2 | 3; // number of gridfinity units wide (37.8 + (n-1)*42 mm)
  baseProfileId?: BaseStlProfileId; // which base STL design to render onto (default "pred")
  embossMode?: EmbossMode; // raised vs flush — flush requires profile.supportsFlush
  placement?: Placements; // per-element nudge/scale on the profile's default boxes (default: no change)
}

/**
 * "raised" — inlay protrudes from the base surface (or fills the natural recess
 * on profiles whose raisedZ is "in"). Default; works on every profile.
 *
 * "flush" — inlay is CSG-carved into the body so the printed top is dead flat.
 * Honored only when the active profile has supportsFlush: true (Cullenect).
 * Profiles without flush support silently render as raised.
 */
export type EmbossMode = "raised" | "flush";

/** What a Download button produces. Chosen per click, not as a global mode. */
export type ExportFormat = "3mf" | "png";

// ---------------------------------------------------------------------------
// Base-STL profile system.
//
// Each base STL (Pred Gridfinity label, Cullenect V2, …) declares its asset
// path, content-box anchors, and emboss semantics. Adding a new design is a
// matter of defining a new BaseStlProfile constant and registering it in the
// PROFILES map in labelGenerator.ts. See fork_decisions.md §D-017.
// ---------------------------------------------------------------------------

export type BaseStlProfileId = "pred" | "cullenect";

/** Inclusive-bounds rectangle (mm), specified in content-origin-local coordinates. */
export interface ContentRect {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface BaseStlProfile {
  /** Stable identifier (kebab-case). Persisted in LabelInput.baseProfileId. */
  id: BaseStlProfileId;
  /** Human-readable name shown in the UI selector. */
  displayName: string;
  /** Filename within web/public/, fetched as `${BASE_URL}${assetPath}`. */
  assetPath: string;
  /**
   * Offset added to the loaded STL's `bounds.min` to derive the content-origin
   * world position. All content rectangles are relative to that origin.
   */
  contentOrigin: { x: number; y: number };
  /** Icon placement box (mm), relative to content origin. */
  iconBox: ContentRect;
  /** Top text line ("line 1") placement box (mm), relative to content origin. */
  line1Box: ContentRect;
  /** Bottom text line ("line 2") placement box (mm), relative to content origin. */
  line2Box: ContentRect;
  /** Extrusion depth of text and icon meshes (mm). */
  embossHeight: number;
  /**
   * Z-positioning convention for raised mode:
   *   "in"    — inlay top face at topZ, body extends below (fills a recess).
   *             Used by Pred (recessed interior with raised perimeter).
   *   "above" — inlay bottom face at topZ, body below (text rides on top).
   *             Used by Cullenect (flat-top body, text protrudes above).
   */
  raisedZ: "in" | "above";
  /** Whether this base supports CSG-carved flush mode in addition to raised. */
  supportsFlush: boolean;
  /**
   * Optional label-widening config (extra mm per Gridfinity unit beyond 1×).
   * Omit/undefined → only 1× supported. Currently only Pred ships widening.
   */
  widening?: { extraWidthPerUnit: number };
}
