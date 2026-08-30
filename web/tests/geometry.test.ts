import { describe, expect, it, vi } from "vitest";
import { fileURLToPath } from "node:url";
import type { BaseStlProfileId } from "../src/types/label";
import { getProfile } from "../src/services/profiles";
import { buildLabelMeshes } from "../src/services/labelGenerator";
import {
  FULL_LABEL,
  bounds,
  centreOf,
  sizeOf,
  stlBounds,
  triangleCount,
  volume,
  worldBox,
  type Vec3,
} from "./helpers";

// The app gets the wasm URL from Vite's `?url` import, which resolves to a
// server path ("/node_modules/…") that node can't read off disk. Point it at
// the real file instead — a bundler detail, not a change in behaviour.
vi.mock("manifold-3d/manifold.wasm?url", () => ({
  default: fileURLToPath(new URL("../node_modules/manifold-3d/manifold.wasm", import.meta.url)),
}));

// Float slack. Everything here is mm: 1 µm is far below any print feature.
const EPS = 1e-3;

/**
 * Where the inlay lands. This is the invariant the 2D preview, the PNG face and
 * the printed part all depend on, so it is asserted against boxes derived from
 * the profile + the real STL's bounds rather than against remembered numbers.
 */
describe.each<BaseStlProfileId>(["pred", "cullenect"])("%s inlay placement", (id) => {
  const profile = getProfile(id);
  const stl = stlBounds(profile);
  const iconBox = worldBox(profile, stl, profile.iconBox);
  const line1Box = worldBox(profile, stl, profile.line1Box);
  const line2Box = worldBox(profile, stl, profile.line2Box);
  // The merged inlay is one mesh; split it back into its three parts by region.
  // The icon column ends where the text column starts, and the two text lines
  // are separated by the gap between their slots.
  const splitX = iconBox.x2;
  const splitY = (line1Box.y1 + line2Box.y2) / 2;
  const parts = {
    icon: (v: Vec3) => v.x < splitX,
    line1: (v: Vec3) => v.x >= splitX && v.y > splitY,
    line2: (v: Vec3) => v.x >= splitX && v.y <= splitY,
  };
  const boxes = { icon: iconBox, line1: line1Box, line2: line2Box };

  // Built once per profile, lazily and inside a test: buildLabelMeshes keeps
  // per-call state in module globals, so two overlapping calls are not safe.
  let cached: Awaited<ReturnType<typeof buildLabelMeshes>> | null = null;
  const built = async () => (cached ??= await buildLabelMeshes({ ...FULL_LABEL, baseProfileId: id }));

  it("leaves the base body at the STL's own size", async () => {
    const b = bounds((await built()).baseGeometry);
    expect(b.min.x).toBeCloseTo(stl.min.x, 3);
    expect(b.max.x).toBeCloseTo(stl.max.x, 3);
    expect(b.min.y).toBeCloseTo(stl.min.y, 3);
    expect(b.max.y).toBeCloseTo(stl.max.y, 3);
    expect(b.max.z).toBeCloseTo(stl.max.z, 3);
  });

  it.each(["icon", "line1", "line2"] as const)("keeps %s inside its content box", async (part) => {
    const b = bounds((await built()).inlayGeometry, parts[part]);
    const box = boxes[part];
    expect(b.min.x).toBeGreaterThanOrEqual(box.x1 - EPS);
    expect(b.max.x).toBeLessThanOrEqual(box.x2 + EPS);
    expect(b.min.y).toBeGreaterThanOrEqual(box.y1 - EPS);
    expect(b.max.y).toBeLessThanOrEqual(box.y2 + EPS);
  });

  it.each(["icon", "line1", "line2"] as const)("centres %s in its content box", async (part) => {
    const b = bounds((await built()).inlayGeometry, parts[part]);
    const c = centreOf(boxes[part]);
    expect((b.min.x + b.max.x) / 2).toBeCloseTo(c.x, 3);
    expect((b.min.y + b.max.y) / 2).toBeCloseTo(c.y, 3);
  });

  it.each(["icon", "line1", "line2"] as const)("sizes %s to fill its box on the limiting axis", async (part) => {
    const b = bounds((await built()).inlayGeometry, parts[part]);
    const { w, h } = sizeOf(boxes[part]);
    const fill = Math.max((b.max.x - b.min.x) / w, (b.max.y - b.min.y) / h);
    // 1 = touches the box on its limiting axis. Text lands just under it: the
    // fitted size comes off a 0.1 mm grid, so up to one step of slack.
    expect(fill).toBeGreaterThan(part === "icon" ? 1 - EPS : 0.95);
    expect(fill).toBeLessThanOrEqual(1 + EPS);
  });

  it(`puts the inlay at the Z its raisedZ "${profile.raisedZ}" promises`, async () => {
    const b = bounds((await built()).inlayGeometry);
    const topZ = stl.max.z;
    const eh = profile.embossHeight;
    // "in" fills the recess (top flush with the perimeter); "above" rides on top.
    const expected = profile.raisedZ === "in" ? [topZ - eh, topZ] : [topZ, topZ + eh];
    expect(b.min.z).toBeCloseTo(expected[0], 3);
    expect(b.max.z).toBeCloseTo(expected[1], 3);
  });
});

describe("label widening", () => {
  const pred = getProfile("pred");
  const perUnit = pred.widening!.extraWidthPerUnit;

  it.each([2, 3] as const)("widens the pred base by %s-1 x extraWidthPerUnit", async (width) => {
    const one = await buildLabelMeshes({ ...FULL_LABEL, baseProfileId: "pred" });
    const wide = await buildLabelMeshes({ ...FULL_LABEL, baseProfileId: "pred", labelWidth: width });
    const a = bounds(one.baseGeometry);
    const b = bounds(wide.baseGeometry);
    expect(b.max.x - b.min.x).toBeCloseTo(a.max.x - a.min.x + (width - 1) * perUnit, 3);
    // Widening pushes the right edge out; the left snap tab must not move.
    expect(b.min.x).toBeCloseTo(a.min.x, 3);
    // Content re-centres on the wider body: half the added width.
    const ai = bounds(one.inlayGeometry);
    const bi = bounds(wide.inlayGeometry);
    expect((bi.min.x + bi.max.x) / 2).toBeCloseTo((ai.min.x + ai.max.x) / 2 + ((width - 1) * perUnit) / 2, 3);
  });

  it("ignores labelWidth on cullenect, which declares no widening", async () => {
    expect(getProfile("cullenect").widening).toBeUndefined();
    const one = await buildLabelMeshes({ ...FULL_LABEL, baseProfileId: "cullenect" });
    const wide = await buildLabelMeshes({ ...FULL_LABEL, baseProfileId: "cullenect", labelWidth: 3 });
    expect(bounds(wide.baseGeometry)).toEqual(bounds(one.baseGeometry));
    expect(bounds(wide.inlayGeometry)).toEqual(bounds(one.inlayGeometry));
  });
});

describe("emboss mode", () => {
  it("carves the cullenect base in flush mode", async () => {
    const raised = await buildLabelMeshes({ ...FULL_LABEL, baseProfileId: "cullenect", embossMode: "raised" });
    const flush = await buildLabelMeshes({ ...FULL_LABEL, baseProfileId: "cullenect", embossMode: "flush" });

    // The carve is real: the body is a different mesh and it lost exactly the
    // inlay's volume. (In flush mode the inlay sits inside the body, so
    // subtract() removes precisely that much.)
    expect(triangleCount(flush.baseGeometry)).not.toBe(triangleCount(raised.baseGeometry));
    const removed = volume(raised.baseGeometry) - volume(flush.baseGeometry);
    expect(removed / volume(flush.inlayGeometry)).toBeCloseTo(1, 2);

    // Outer size is untouched — carving inward, not shrinking the body.
    expect(bounds(flush.baseGeometry)).toEqual(bounds(raised.baseGeometry));

    // And the inlay dropped into the body instead of riding on top of it.
    const topZ = stlBounds(getProfile("cullenect")).max.z;
    expect(bounds(flush.inlayGeometry).max.z).toBeCloseTo(topZ, 3);
    expect(bounds(raised.inlayGeometry).max.z).toBeCloseTo(topZ + getProfile("cullenect").embossHeight, 3);
  });

  it("silently downgrades flush to raised on pred, which cannot carve", async () => {
    expect(getProfile("pred").supportsFlush).toBe(false);
    const raised = await buildLabelMeshes({ ...FULL_LABEL, baseProfileId: "pred", embossMode: "raised" });
    const asked = await buildLabelMeshes({ ...FULL_LABEL, baseProfileId: "pred", embossMode: "flush" });
    // Not carved: same triangle count and same volume as the raised body.
    expect(triangleCount(asked.baseGeometry)).toBe(triangleCount(raised.baseGeometry));
    expect(volume(asked.baseGeometry)).toBeCloseTo(volume(raised.baseGeometry), 6);
    expect(bounds(asked.inlayGeometry)).toEqual(bounds(raised.inlayGeometry));
  });
});
