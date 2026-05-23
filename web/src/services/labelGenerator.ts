import {
  Box3,
  BufferGeometry,
  ExtrudeGeometry,
  Mesh,
  MeshNormalMaterial,
  Shape,
  ShapeGeometry,
  ShapePath,
} from "three";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { SVGLoader } from "three/examples/jsm/loaders/SVGLoader.js";
import { FontLoader, type Font } from "three/examples/jsm/loaders/FontLoader.js";
import { mergeGeometries, mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type {
  BaseStlProfile,
  BaseStlProfileId,
  ContentRect,
  EmbossMode,
  LabelInput,
} from "../types/label";
import { PRED_PROFILE, getProfile } from "./profiles";

// Tighter letter spacing: each glyph's horizontal advance is reduced by this
// factor. Glyphs themselves are unchanged (no squishing), only the gaps between
// them shrink. The smaller total width lets chooseTextSizeForBox pick a larger
// font size, making strokes proportionally thicker — important for sliceability.
// Profile-agnostic — tracking is a font-rendering concern, not a label-design one.
const TRACKING = 0.95;

type Rect = ContentRect;

const material = new MeshNormalMaterial();
const stlLoader = new STLLoader();
const svgLoader = new SVGLoader();

// Per-profile asset cache. Keyed by profile id so each STL is fetched + parsed
// at most once for the lifetime of the page.
interface LoadedProfile {
  baseGeometry: BufferGeometry;
  topZ: number;
  contentOriginX: number;
  contentOriginY: number;
}
const profileCache = new Map<BaseStlProfileId, Promise<LoadedProfile>>();
let fontPromise: Promise<Font> | null = null;

// Per-call state. Set at the start of buildLabelMeshes; helper functions read
// these. Not concurrent-safe — see fork_plan.md gotchas. Acceptable for the
// existing single-call-at-a-time UX.
let activeProfile: BaseStlProfile = PRED_PROFILE;
let activeLoaded: LoadedProfile | null = null;
let activeFont: Font | null = null;
let activeMode: EmbossMode = "raised";
let contentXOffset = 0; // shifts content right to centre it on wider labels

async function loadFont(): Promise<Font> {
  if (fontPromise) return fontPromise;
  const base = import.meta.env.BASE_URL;
  fontPromise = (async () => {
    const resp = await fetch(`${base}helvetiker_bold.typeface.json`);
    if (!resp.ok) throw new Error("Failed to load font");
    return new FontLoader().parse(await resp.json());
  })();
  return fontPromise;
}

async function loadProfile(profile: BaseStlProfile): Promise<LoadedProfile> {
  const existing = profileCache.get(profile.id);
  if (existing) return existing;
  const base = import.meta.env.BASE_URL;
  const promise = (async () => {
    const resp = await fetch(`${base}${profile.assetPath}`);
    if (!resp.ok) throw new Error(`Failed to load base STL: ${profile.assetPath}`);
    const geometry = stlLoader.parse(await resp.arrayBuffer());
    geometry.computeBoundingBox();
    const bounds = geometry.boundingBox ?? new Box3();
    return {
      baseGeometry: geometry,
      topZ: bounds.max.z,
      contentOriginX: bounds.min.x + profile.contentOrigin.x,
      contentOriginY: bounds.min.y + profile.contentOrigin.y,
    };
  })();
  profileCache.set(profile.id, promise);
  return promise;
}

function cloneBaseMesh(): Mesh<BufferGeometry> {
  return new Mesh(activeLoaded!.baseGeometry.clone(), material);
}

/**
 * Z-positioning for inlay (text + icon) meshes.
 *
 * Text meshes have no rotation, so `position.z` is the BOTTOM of the geometry
 * and the extrusion runs upward by `embossHeight`.
 *
 * Icon meshes go through `geometry.rotateX(Math.PI)` (to flip the Y axis from
 * SVG-screen-coords to 3D world-coords). That rotation also negates Z, so the
 * extrusion direction inverts: `position.z` becomes the TOP and the depth
 * runs downward from there.
 *
 * Mode + raisedZ matrix:
 *
 *   flush (any profile)          → inlay top at topZ (carved into body via CSG)
 *   raised + raisedZ "in"        → inlay top at topZ (fills natural recess)
 *   raised + raisedZ "above"     → inlay bottom at topZ (rides on top of body)
 *
 * The flush case and the raised+"in" case land on the same coordinates; the
 * difference is whether CSG runs afterwards to carve the matching cavity.
 */
function inlayZ(): { textZ: number; iconZ: number } {
  const topZ = activeLoaded!.topZ;
  const eh = activeProfile.embossHeight;
  if (activeMode === "flush" || activeProfile.raisedZ === "in") {
    return { textZ: topZ - eh, iconZ: topZ };
  }
  return { textZ: topZ, iconZ: topZ + eh };
}

// Generates Three.js shapes for `text` at `size` with reduced letter spacing.
// Replicates Three.js FontLoader's internal createPaths logic so we can apply
// a custom tracking multiplier to each glyph's horizontal advance (ha).
function generateShapesWithTracking(text: string, size: number): Shape[] {
  const data = (activeFont as any).data as {
    resolution: number;
    glyphs: Record<string, { ha: number; o?: string; _cachedOutline?: string[] }>;
  };
  const scale = size / data.resolution;
  const shapes: Shape[] = [];
  let offsetX = 0;

  for (const char of text) {
    const glyph = data.glyphs[char] ?? data.glyphs["?"];
    if (!glyph) continue;

    if (glyph.o) {
      const path = new ShapePath();
      const outline = glyph._cachedOutline ?? (glyph._cachedOutline = glyph.o.split(" "));
      let i = 0;
      while (i < outline.length) {
        const action = outline[i++];
        if (action === "m") {
          path.moveTo(+outline[i++] * scale + offsetX, +outline[i++] * scale);
        } else if (action === "l") {
          path.lineTo(+outline[i++] * scale + offsetX, +outline[i++] * scale);
        } else if (action === "q") {
          // typeface.json order: end x/y then control x/y
          const ex = +outline[i++] * scale + offsetX, ey = +outline[i++] * scale;
          const cx = +outline[i++] * scale + offsetX, cy = +outline[i++] * scale;
          path.quadraticCurveTo(cx, cy, ex, ey);
        } else if (action === "b") {
          const ex  = +outline[i++] * scale + offsetX, ey  = +outline[i++] * scale;
          const c1x = +outline[i++] * scale + offsetX, c1y = +outline[i++] * scale;
          const c2x = +outline[i++] * scale + offsetX, c2y = +outline[i++] * scale;
          path.bezierCurveTo(c1x, c1y, c2x, c2y, ex, ey);
        }
      }
      shapes.push(...path.toShapes(false));
    }

    offsetX += glyph.ha * scale * TRACKING;
  }

  return shapes;
}

function toExtrudedMesh(shapes: Shape[], depth: number): Mesh {
  const geometry = new ExtrudeGeometry(shapes, {
    depth,
    bevelEnabled: false,
    curveSegments: 10,
  });
  geometry.computeVertexNormals();
  return new Mesh(geometry, material);
}

function getTextBounds(text: string, size: number): Box3 | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const shapes = generateShapesWithTracking(trimmed, size);
  if (shapes.length === 0) return null;
  const geometry = new ShapeGeometry(shapes);
  geometry.computeBoundingBox();
  return geometry.boundingBox;
}

function getMeshBounds(mesh: Mesh): Box3 {
  mesh.updateMatrixWorld(true);
  return new Box3().setFromObject(mesh);
}

function getBoxSize(box: Rect): { width: number; height: number } {
  return { width: box.x2 - box.x1, height: box.y2 - box.y1 };
}

function toWorldBox(box: Rect): Rect {
  const ox = activeLoaded!.contentOriginX;
  const oy = activeLoaded!.contentOriginY;
  return {
    x1: ox + contentXOffset + box.x1,
    y1: oy + box.y1,
    x2: ox + contentXOffset + box.x2,
    y2: oy + box.y2,
  };
}

/**
 * Widens a cloned base geometry by shifting all vertices whose X coordinate
 * is right of the geometric midpoint. This extends the flat centre area while
 * keeping both snap-edge profiles intact.
 */
function widenGeometry(geometry: BufferGeometry, extraWidth: number): void {
  geometry.computeBoundingBox();
  const bounds = geometry.boundingBox!;
  const threshold = (bounds.min.x + bounds.max.x) / 2;
  const pos = geometry.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    if (pos.getX(i) > threshold) {
      pos.setX(i, pos.getX(i) + extraWidth);
    }
  }
  pos.needsUpdate = true;
  geometry.computeBoundingBox();
  geometry.computeVertexNormals();
}

function buildSvgMeshInBox(svgString: string, box: Rect): Mesh | null {
  if (!svgString) return null;
  const parsed = svgLoader.parse(svgString);
  const shapes: Shape[] = [];
  for (const p of parsed.paths) {
    shapes.push(...SVGLoader.createShapes(p));
  }
  if (shapes.length === 0) return null;

  const extruded = toExtrudedMesh(shapes, activeProfile.embossHeight);
  const sourceBounds = getMeshBounds(extruded);
  const sourceWidth = sourceBounds.max.x - sourceBounds.min.x;
  const sourceHeight = sourceBounds.max.y - sourceBounds.min.y;
  if (sourceWidth <= 0 || sourceHeight <= 0) return null;

  const target = toWorldBox(box);
  const targetSize = getBoxSize(target);
  const scale = Math.min(targetSize.width / sourceWidth, targetSize.height / sourceHeight);

  // SVG assets use screen coordinates where Y grows downward. Rotate the
  // geometry around X instead of using a negative scale so triangle winding
  // stays outward-facing. Side effect: rotateX(PI) also negates Z, so the
  // extrusion now runs in -Z; final Z position is set via inlayZ().iconZ
  // (compensates per the active profile's raisedZ semantics).
  extruded.geometry.rotateX(Math.PI);
  extruded.geometry.scale(scale, scale, 1);
  extruded.geometry.computeVertexNormals();

  const scaledBounds = getMeshBounds(extruded);
  const scaledWidth = scaledBounds.max.x - scaledBounds.min.x;
  const scaledHeight = scaledBounds.max.y - scaledBounds.min.y;
  const tx = target.x1 + (targetSize.width - scaledWidth) / 2 - scaledBounds.min.x;
  const ty = target.y1 + (targetSize.height - scaledHeight) / 2 - scaledBounds.min.y;

  extruded.position.set(tx, ty, inlayZ().iconZ);
  return extruded;
}

function buildIconMesh(iconSvg: string): Mesh | null {
  return buildSvgMeshInBox(iconSvg, activeProfile.iconBox);
}

function buildIconTextMeshes(text: string): Mesh[] {
  const target = toWorldBox(activeProfile.iconBox);
  const targetSize = getBoxSize(target);

  // Split e.g. "TX10" → ["TX", "10"] so each part fills its own half and renders larger
  const match = text.match(/^([A-Za-z]+)(\d+.*)$/);
  if (match) {
    const [, prefix, number] = match;
    const GAP = 1.0; // mm gap between the two lines
    const halfHeight = (targetSize.height - GAP) / 2;
    const botY = target.y1;
    const topY = target.y1 + halfHeight + GAP;

    const topSize = chooseTextSizeForBox(prefix, targetSize.width, halfHeight);
    const topMesh = createTextLineMesh(prefix, topSize, target.x1, topY, targetSize.width, halfHeight);

    const botSize = chooseTextSizeForBox(number, targetSize.width, halfHeight);
    const botMesh = createTextLineMesh(number, botSize, target.x1, botY, targetSize.width, halfHeight);

    return [topMesh, botMesh].filter(Boolean) as Mesh[];
  }

  const size = chooseTextSizeForBox(text, targetSize.width, targetSize.height);
  const mesh = createTextLineMesh(text, size, target.x1, target.y1, targetSize.width, targetSize.height);
  return mesh ? [mesh] : [];
}

function chooseTextSizeForBox(text: string, maxWidth: number, maxHeight: number): number {
  let size = 6;
  const minSize = 1.2;
  while (size > minSize) {
    const bounds = getTextBounds(text, size);
    const width = bounds ? bounds.max.x - bounds.min.x : 0;
    const height = bounds ? bounds.max.y - bounds.min.y : 0;
    if (width <= maxWidth && height <= maxHeight) return size;
    size -= 0.1;
  }
  return minSize;
}

function createTextLineMesh(
  text: string,
  size: number,
  x: number,
  y: number,
  width: number,
  height: number
): Mesh | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const shapes = generateShapesWithTracking(trimmed, size);
  if (shapes.length === 0) return null;

  const geometry = new ExtrudeGeometry(shapes, {
    depth: activeProfile.embossHeight,
    bevelEnabled: false,
    curveSegments: 10,
  });
  geometry.computeBoundingBox();
  const bounds = geometry.boundingBox;
  if (!bounds) return null;

  const textWidth = bounds.max.x - bounds.min.x;
  const textHeight = bounds.max.y - bounds.min.y;
  if (textWidth <= 0 || textHeight <= 0) return null;

  const scale = Math.min(1, width / textWidth, height / textHeight);
  const scaledWidth = textWidth * scale;
  const scaledHeight = textHeight * scale;

  const mesh = new Mesh(geometry, material);
  mesh.scale.set(scale, scale, 1);

  const tx = x + (width - scaledWidth) / 2 - bounds.min.x * scale;
  const ty = y + (height - scaledHeight) / 2 - bounds.min.y * scale;
  mesh.position.set(tx, ty, inlayZ().textZ);
  return mesh;
}

function buildTextMeshes(label: LabelInput): Mesh[] {
  const topBox = toWorldBox(activeProfile.line1Box);
  const bottomBox = toWorldBox(activeProfile.line2Box);
  const topSize = getBoxSize(topBox);
  const bottomSize = getBoxSize(bottomBox);

  const meshes: Mesh[] = [];

  const topFontSize = chooseTextSizeForBox(label.line1, topSize.width, topSize.height);
  const line1Mesh = createTextLineMesh(label.line1, topFontSize, topBox.x1, topBox.y1, topSize.width, topSize.height);
  if (line1Mesh) meshes.push(line1Mesh);

  if (label.line2Svg) {
    const line2Mesh = buildSvgMeshInBox(label.line2Svg, activeProfile.line2Box);
    if (line2Mesh) meshes.push(line2Mesh);
  } else {
    const bottomFontSize = chooseTextSizeForBox(label.line2, bottomSize.width, bottomSize.height);
    const line2Mesh = createTextLineMesh(label.line2, bottomFontSize, bottomBox.x1, bottomBox.y1, bottomSize.width, bottomSize.height);
    if (line2Mesh) meshes.push(line2Mesh);
  }

  return meshes;
}

export interface LabelMeshes {
  /** Carved/clean base body geometry. World coordinates already baked in. */
  baseGeometry: BufferGeometry;
  /**
   * All inlay shapes (line1, line2, icon) concatenated into a single
   * BufferGeometry with disconnected triangle islands. Slicers treat this as
   * one paintable part, sidestepping the STL "split → one part per letter"
   * problem. World coordinates already baked in.
   */
  inlayGeometry: BufferGeometry;
}

export async function buildLabelMeshes(label: LabelInput): Promise<LabelMeshes> {
  if (!label.line1.trim() && !label.line2.trim()) {
    throw new Error("At least one text line is required.");
  }

  const profile = getProfile(label.baseProfileId);
  const requestedMode: EmbossMode = label.embossMode ?? "raised";
  // Silently downgrade flush → raised on profiles that don't support it.
  // Defensive: the UI should already hide the toggle in that case.
  const mode: EmbossMode = requestedMode === "flush" && profile.supportsFlush ? "flush" : "raised";

  const [loaded, font] = await Promise.all([loadProfile(profile), loadFont()]);

  // Activate this profile's state for the helpers (toWorldBox / inlayZ / etc).
  activeProfile = profile;
  activeLoaded = loaded;
  activeFont = font;
  activeMode = mode;

  const width = label.labelWidth ?? 1;
  const widening = profile.widening;
  const extraWidth = widening ? (width - 1) * widening.extraWidthPerUnit : 0;
  contentXOffset = extraWidth / 2;

  const baseMesh = cloneBaseMesh();
  if (extraWidth > 0) widenGeometry(baseMesh.geometry, extraWidth);

  const inlayMeshes: Mesh[] = [];
  if (label.iconText) {
    inlayMeshes.push(...buildIconTextMeshes(label.iconText));
  } else {
    const iconMesh = buildIconMesh(label.iconSvg);
    if (iconMesh) inlayMeshes.push(iconMesh);
  }
  inlayMeshes.push(...buildTextMeshes(label));

  let baseGeometry = bakePositionOnly(baseMesh);
  const inlayGeometry = mergeInlayMeshes(inlayMeshes);

  if (mode === "flush") {
    // Carve the inlay shape out of the base so both parts are individually
    // manifold and the printed top is flush. manifold-3d is dynamic-imported
    // here — the ~482 KB wasm only fetches on first flush export.
    const { subtract } = await import("./csg");
    const carved = await subtract(baseGeometry, inlayGeometry);
    baseGeometry = mergeVertices(carved, 1e-4);
  }

  return { baseGeometry, inlayGeometry };
}

// Returns a position-only, vertex-deduped BufferGeometry with mesh.matrixWorld
// baked in. Three steps:
//   1. Strip to position (+ index) only — 3MF doesn't carry normals/UVs.
//   2. Apply mesh.matrixWorld so the geometry is in final world coordinates.
//   3. mergeVertices to convert to indexed geometry with shared edges.
//
// Step 3 is critical for slicer compatibility: STLLoader and ExtrudeGeometry
// both produce non-indexed geometry where every triangle owns 3 unique
// vertices. When that lands in a 3MF, slicers (Orca in particular) treat it
// as a soup of disconnected triangles — every edge is reported non-manifold.
// mergeVertices walks the position array, hashes each vertex to the tolerance,
// and emits indexed output where coincident vertices are shared. See
// fork_decisions.md §D-014.
function bakePositionOnly(mesh: Mesh): BufferGeometry {
  mesh.updateMatrixWorld(true);
  const src = mesh.geometry as BufferGeometry;
  const position = src.getAttribute("position");
  if (!position) {
    throw new Error("Mesh geometry has no position attribute");
  }
  const out = new BufferGeometry();
  out.setAttribute("position", position.clone());
  if (src.index) out.setIndex(src.index.clone());
  out.applyMatrix4(mesh.matrixWorld);
  // 1e-4 mm = 0.1 µm — well below any meaningful print feature, well above
  // float-precision noise from the matrix-world bake.
  return mergeVertices(out, 1e-4);
}

function mergeInlayMeshes(meshes: Mesh[]): BufferGeometry {
  const baked = meshes.map(bakePositionOnly);
  if (baked.length === 0) return new BufferGeometry();
  if (baked.length === 1) return baked[0];
  const merged = mergeGeometries(baked, false);
  if (!merged) {
    // Geometry attribute mismatch — should not happen since bakePositionOnly
    // strips to position-only, but fall back to the first geometry rather
    // than emit a broken 3MF.
    return baked[0];
  }
  return merged;
}
