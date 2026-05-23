import type { BaseStlProfile, BaseStlProfileId } from "../types/label";

// Lightweight module: holds the per-STL profile constants used by both the
// generator (services/labelGenerator.ts) and the UI selector (App.tsx).
// Kept free of Three.js / fflate imports so it stays in the main chunk and
// doesn't drag the generator pipeline into the initial page load.
// See fork_decisions.md §D-020.

/**
 * Pred Gridfinity label — original base STL, recessed interior with raised
 * perimeter / snap-tabs. Inlay fills the recess (raisedZ: "in"). 1U/2U/3U
 * widening supported via the geometric-midpoint vertex shift.
 */
export const PRED_PROFILE: BaseStlProfile = {
  id: "pred",
  displayName: "Pred Gridfinity",
  assetPath: "GridfinityBinLabel.stl",
  contentOrigin: { x: 1.5, y: 0.5 },
  iconBox: { x1: 1.5, y1: 0.5, x2: 11, y2: 10 },
  line1Box: { x1: 11, y1: 5.75, x2: 34.5, y2: 10 },
  line2Box: { x1: 11, y1: 0.5, x2: 34.5, y2: 4.75 },
  embossHeight: 0.4,
  raisedZ: "in",
  supportsFlush: false,
  widening: { extraWidthPerUnit: 42 },
};

/**
 * Cullenect V2 label — 36×11×1.2 mm flat-bodied design. Inlay rides on top of
 * the body (raisedZ: "above"). Supports flush mode via manifold-3d CSG
 * (Stage 4). Content boxes match Pred for "equal value" output across STLs.
 */
export const CULLENECT_PROFILE: BaseStlProfile = {
  id: "cullenect",
  displayName: "Cullenect V2",
  assetPath: "CullenectBinLabel.stl",
  // Cullenect bounds anchor at (0, 0) and have no snap-tab extension. Offset
  // (0, 0) keeps content world positions identical to Pred's: icon at world
  // X[1.5, 11], text at world X[11, 34.5]. Y centers within 0.01 mm of Pred.
  contentOrigin: { x: 0, y: 0 },
  iconBox: { x1: 1.5, y1: 0.5, x2: 11, y2: 10 },
  line1Box: { x1: 11, y1: 5.75, x2: 34.5, y2: 10 },
  line2Box: { x1: 11, y1: 0.5, x2: 34.5, y2: 4.75 },
  // 0.4 mm = 2 layers at 0.2 mm layer height. Bumped up from the diagram's
  // 0.2 mm because single-layer color changes aren't always reliable on
  // multi-material setups; two layers prints solidly.
  embossHeight: 0.4,
  raisedZ: "above",
  supportsFlush: true,
};

const PROFILES: Record<BaseStlProfileId, BaseStlProfile> = {
  pred: PRED_PROFILE,
  cullenect: CULLENECT_PROFILE,
};

/** Resolve a profile by id; falls back to Pred for unknown / undefined ids. */
export function getProfile(id: BaseStlProfileId | undefined): BaseStlProfile {
  return PROFILES[id ?? "pred"] ?? PROFILES.pred;
}

/** Profile catalog for UI selectors. Stable order: Pred first, then others. */
export function listProfiles(): BaseStlProfile[] {
  return [PROFILES.pred, PROFILES.cullenect];
}
