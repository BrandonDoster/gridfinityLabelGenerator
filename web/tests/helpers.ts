import { readFileSync } from "node:fs";
import { strFromU8, unzipSync } from "fflate";
import type { BufferGeometry } from "three";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import type { BaseStlProfile, ContentRect, LabelInput } from "../src/types/label";
import { getIcon } from "../src/assets/icons";

/** A label with all three elements present, so no auto-layout rule fires. */
export const FULL_LABEL: LabelInput = {
  title: "M3x10",
  line1: "M3X10",
  line2: "SCREW",
  iconSvg: getIcon("hex")!.svg,
  iconViewBox: getIcon("hex")!.viewBox,
};

export interface Vec3 { x: number; y: number; z: number; }
export interface Bounds { min: Vec3; max: Vec3; }

/** Read a 3MF ArrayBuffer back as { entry name -> text }. */
export function unzipText(zip: ArrayBuffer | Uint8Array): Record<string, string> {
  const entries = unzipSync(zip instanceof Uint8Array ? zip : new Uint8Array(zip));
  return Object.fromEntries(Object.entries(entries).map(([k, v]) => [k, strFromU8(v)]));
}

/** Parse XML, failing the caller loudly if it isn't well-formed. */
export function parseXml(xml: string): Document {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  const err = doc.querySelector("parsererror");
  if (err) throw new Error(`malformed XML: ${err.textContent}`);
  return doc;
}

/**
 * Bounding box over the geometry's vertices, optionally only those passing
 * `keep`. The inlay ships as one merged mesh, so filtering by region is how a
 * test isolates the icon from line 1 from line 2.
 */
export function bounds(geo: BufferGeometry, keep?: (v: Vec3) => boolean): Bounds {
  const pos = geo.getAttribute("position");
  const min = { x: Infinity, y: Infinity, z: Infinity };
  const max = { x: -Infinity, y: -Infinity, z: -Infinity };
  for (let i = 0; i < pos.count; i++) {
    const v = { x: pos.getX(i), y: pos.getY(i), z: pos.getZ(i) };
    if (keep && !keep(v)) continue;
    min.x = Math.min(min.x, v.x); min.y = Math.min(min.y, v.y); min.z = Math.min(min.z, v.z);
    max.x = Math.max(max.x, v.x); max.y = Math.max(max.y, v.y); max.z = Math.max(max.z, v.z);
  }
  if (min.x === Infinity) throw new Error("bounds(): no vertices matched");
  return { min, max };
}

/**
 * Signed volume of a closed triangle mesh (sum of tetrahedra to the origin).
 * The sign is the winding: a mirrored mesh flips it, which is what a negative
 * placement scale would do.
 */
export function signedVolume(geo: BufferGeometry): number {
  const pos = geo.getAttribute("position");
  const idx = geo.index;
  const count = idx ? idx.count : pos.count;
  const at = (n: number) => (idx ? idx.getX(n) : n);
  let total = 0;
  for (let i = 0; i + 2 < count; i += 3) {
    const a = at(i), b = at(i + 1), c = at(i + 2);
    const ax = pos.getX(a), ay = pos.getY(a), az = pos.getZ(a);
    const bx = pos.getX(b), by = pos.getY(b), bz = pos.getZ(b);
    const cx = pos.getX(c), cy = pos.getY(c), cz = pos.getZ(c);
    total += (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6;
  }
  return total;
}

/** Enclosed volume, sign-independent. */
export const volume = (geo: BufferGeometry) => Math.abs(signedVolume(geo));

/** Triangles with no area — they carry no surface and confuse slicers. */
export function zeroAreaTriangles(geo: BufferGeometry): number {
  const pos = geo.getAttribute("position");
  const idx = geo.index;
  const count = idx ? idx.count : pos.count;
  const at = (n: number) => (idx ? idx.getX(n) : n);
  let n = 0;
  for (let i = 0; i + 2 < count; i += 3) {
    const a = at(i), b = at(i + 1), c = at(i + 2);
    const ux = pos.getX(b) - pos.getX(a), uy = pos.getY(b) - pos.getY(a), uz = pos.getZ(b) - pos.getZ(a);
    const vx = pos.getX(c) - pos.getX(a), vy = pos.getY(c) - pos.getY(a), vz = pos.getZ(c) - pos.getZ(a);
    if (Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) === 0) n++;
  }
  return n;
}

export function triangleCount(geo: BufferGeometry): number {
  return (geo.index ? geo.index.count : geo.getAttribute("position").count) / 3;
}

const stl = new STLLoader();

/** Bounds of a profile's real base STL, straight off disk. */
export function stlBounds(profile: BaseStlProfile): Bounds {
  const file = readFileSync(new URL(`../public/${profile.assetPath}`, import.meta.url));
  const geo = stl.parse(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength));
  const b = bounds(geo);
  return b;
}

/**
 * A profile content box in world coordinates — the same mapping
 * labelGenerator's toWorldBox does: STL bounds.min + contentOrigin + the box.
 */
export function worldBox(profile: BaseStlProfile, b: Bounds, box: ContentRect): ContentRect {
  return {
    x1: b.min.x + profile.contentOrigin.x + box.x1,
    y1: b.min.y + profile.contentOrigin.y + box.y1,
    x2: b.min.x + profile.contentOrigin.x + box.x2,
    y2: b.min.y + profile.contentOrigin.y + box.y2,
  };
}

export const centreOf = (r: ContentRect) => ({ x: (r.x1 + r.x2) / 2, y: (r.y1 + r.y2) / 2 });
export const sizeOf = (r: ContentRect) => ({ w: r.x2 - r.x1, h: r.y2 - r.y1 });
