import { afterEach, describe, expect, it, vi } from "vitest";
import { BufferAttribute, BufferGeometry } from "three";
import type { BaseStlProfileId, LabelInput } from "../src/types/label";
import { PRED_PROFILE, getPreviewLayout, getProfile } from "../src/services/profiles";
import { buildLabelMeshes } from "../src/services/labelGenerator";
import { DEFAULT_PLACEMENT, type Placement } from "../src/services/placement";
import { FULL_LABEL, bounds, signedVolume, stlBounds, volume, worldBox, zeroAreaTriangles } from "./helpers";
import { publicFetch } from "./setup";

// One test per bug that shipped. A failure here should name what broke.

afterEach(() => {
  globalThis.fetch = publicFetch;
  vi.resetModules();
});

const withPlacement = (p: Placement): LabelInput => ({
  ...FULL_LABEL,
  baseProfileId: "pred",
  placement: { icon: p, line1: p, line2: p },
});

describe("degenerate placement scale never reaches the geometry", () => {
  // adjustRect/adjustBox clamp to MIN_SCALE; App clamps the input too. The
  // consequence that matters is geometric: scale 0 collapses the extrusion to a
  // point and a negative mirrors it, inverting triangle winding.
  it.each([0, -1, Number.NaN])("clamps scale %s to the 0.1 floor", async (scale) => {
    const clamped = await buildLabelMeshes(withPlacement({ dx: 0, dy: 0, scale: 0.1 }));
    const bad = await buildLabelMeshes(withPlacement({ dx: 0, dy: 0, scale }));
    expect(bounds(bad.inlayGeometry)).toEqual(bounds(clamped.inlayGeometry));

    // …and what comes out is still a solid: positive extent on every axis.
    const b = bounds(bad.inlayGeometry);
    expect(b.max.x - b.min.x).toBeGreaterThan(0);
    expect(b.max.y - b.min.y).toBeGreaterThan(0);
    expect(b.max.z - b.min.z).toBeGreaterThan(0);
  });

  it("neither flattens nor mirrors the inlay at a collapsed scale", async () => {
    const normal = await buildLabelMeshes(withPlacement(DEFAULT_PLACEMENT));
    // Winding: a negative scale mirrors the mesh, flipping the volume's sign
    // and turning every face inside-out for the slicer.
    expect(Math.sign(signedVolume(normal.inlayGeometry))).not.toBe(0);
    for (const scale of [0, -1, Number.NaN]) {
      const bad = await buildLabelMeshes(withPlacement({ dx: 0, dy: 0, scale }));
      expect(Math.sign(signedVolume(bad.inlayGeometry)))
        .toBe(Math.sign(signedVolume(normal.inlayGeometry)));
      expect(volume(bad.inlayGeometry)).toBeGreaterThan(0);
      // No *extra* zero-area triangles: ExtrudeGeometry's glyph triangulation
      // emits a handful at any scale, so the bar is "no worse than normal".
      expect(zeroAreaTriangles(bad.inlayGeometry))
        .toBeLessThanOrEqual(zeroAreaTriangles(normal.inlayGeometry));
    }
  });
});

describe("a failed asset fetch is retryable", () => {
  // The loaders cache the in-flight promise. A cached *rejection* would make
  // every later export re-throw the stale error until the page reloads.
  async function failFirst(match: (url: string) => boolean) {
    let failed = false;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      if (!failed && match(String(input))) {
        failed = true;
        throw new TypeError("network down");
      }
      return publicFetch(input);
    }) as typeof fetch;
    vi.resetModules();
    return (await import("../src/services/labelGenerator")).buildLabelMeshes;
  }

  it("re-fetches the base STL after loadProfile rejected", async () => {
    const build = await failFirst((url) => url.endsWith(".stl"));
    await expect(build(FULL_LABEL)).rejects.toThrow("network down");
    await expect(build(FULL_LABEL)).resolves.toHaveProperty("baseGeometry");
  });

  it("re-fetches the font after loadFont rejected", async () => {
    const build = await failFirst((url) => url.endsWith(".json"));
    await expect(build(FULL_LABEL)).rejects.toThrow("network down");
    await expect(build(FULL_LABEL)).resolves.toHaveProperty("inlayGeometry");
  });

  it("re-loads the manifold wasm runtime after loadRuntime rejected", async () => {
    // Stubbed rather than run for real: the point is the cache eviction in
    // csg.ts, and a stub is the only way to make the wasm load fail on demand.
    const runtime = {
      setup: vi.fn(),
      Mesh: class { constructor(readonly m: unknown) {} },
      Manifold: class {
        constructor(readonly m: unknown) {}
        subtract() {
          return {
            getMesh: () => ({ numProp: 3, vertProperties: new Float32Array(9), triVerts: new Uint32Array([0, 1, 2]) }),
            delete: () => {},
          };
        }
        delete() {}
      },
    };
    const Module = vi.fn()
      .mockRejectedValueOnce(new Error("wasm fetch failed"))
      .mockResolvedValue(runtime);
    vi.resetModules();
    vi.doMock("manifold-3d", () => ({ default: Module }));
    vi.doMock("manifold-3d/manifold.wasm?url", () => ({ default: "manifold.wasm" }));
    try {
      const { subtract } = await import("../src/services/csg");
      const geo = new BufferGeometry();
      geo.setAttribute("position", new BufferAttribute(new Float32Array(9), 3));
      await expect(subtract(geo, geo)).rejects.toThrow("wasm fetch failed");
      // A cached rejection would return the same failure without ever calling
      // Module again.
      await expect(subtract(geo, geo)).resolves.toBeInstanceOf(BufferGeometry);
      expect(Module).toHaveBeenCalledTimes(2);
    } finally {
      vi.doUnmock("manifold-3d");
      vi.doUnmock("manifold-3d/manifold.wasm?url");
    }
  });
});

it("throws when the inlay merge fails instead of exporting only the first part", async () => {
  // The old fallback returned baked[0], so text or the icon just vanished from
  // the 3MF with nothing logged anywhere.
  const utils = "three/examples/jsm/utils/BufferGeometryUtils.js";
  const actual = await vi.importActual<Record<string, unknown>>(utils);
  vi.resetModules();
  vi.doMock(utils, () => ({ ...actual, mergeGeometries: () => null }));
  try {
    const { buildLabelMeshes: build } = await import("../src/services/labelGenerator");
    // Three inlay parts (icon + two lines), so the merge is actually reached.
    await expect(build(FULL_LABEL)).rejects.toThrow("Failed to merge inlay geometries");
  } finally {
    vi.doUnmock(utils);
  }
});

describe("the 2D preview face agrees with the exported mesh", () => {
  // Pred's preview boxes were hand-tuned and drifted from the mesh for a long
  // time with nothing to catch it. The mapping from world (3D, Y up) to preview
  // (SVG, Y down) is fixed by the STL's own bounds:
  //     preview x = world x  - bounds.min.x
  //     preview y = bounds.max.y - world y2
  it.each<BaseStlProfileId>(["pred", "cullenect"])("%s", (id) => {
    const profile = getProfile(id);
    const stl = stlBounds(profile);
    const layout = getPreviewLayout(profile);

    // The preview face is the STL's own visible face, or the mapping is moot.
    expect(stl.max.x - stl.min.x).toBeCloseTo(layout.width, 3);
    expect(stl.max.y - stl.min.y).toBeCloseTo(layout.height, 3);

    for (const key of ["iconBox", "line1Box", "line2Box"] as const) {
      const w = worldBox(profile, stl, profile[key]);
      const expected = { x: w.x1 - stl.min.x, y: stl.max.y - w.y2, w: w.x2 - w.x1, h: w.y2 - w.y1 };
      const actual = layout[key];
      for (const axis of ["x", "y", "w", "h"] as const) {
        expect(actual[axis], `${id} ${key}.${axis}`).toBeCloseTo(expected[axis], 3);
      }
    }
  });

  it("keeps pred's hand-written overrides as the derivation's exact answer", () => {
    // Same check, but against the literal override object — so deleting an
    // override (falling back to derivePreviewBox, which ignores contentOrigin)
    // fails here rather than silently shifting the preview by 1.5 mm.
    expect(PRED_PROFILE.preview?.iconBox).toEqual({ x: 3, y: 1, w: 9.5, h: 9.5 });
    expect(PRED_PROFILE.preview?.line1Box).toEqual({ x: 12.5, y: 1, w: 23.5, h: 4.25 });
    expect(PRED_PROFILE.preview?.line2Box).toEqual({ x: 12.5, y: 6.25, w: 23.5, h: 4.25 });
  });
});

// The two node self-checks are scripts of bare asserts; importing them runs
// every assertion. `npm run check` still runs them under plain node — this just
// makes their failures show up in `npm test` as well.
describe("node self-checks", () => {
  it("placement.check.ts", async () => {
    await expect(import("../src/services/placement.check.ts")).resolves.toBeTruthy();
  });
  it("layout.check.ts", async () => {
    await expect(import("../src/services/layout.check.ts")).resolves.toBeTruthy();
  });
});

// Not a regression, just the invariant the default placement rests on.
it("leaves geometry untouched at the default placement", async () => {
  const withDefault = await buildLabelMeshes(withPlacement(DEFAULT_PLACEMENT));
  const without = await buildLabelMeshes({ ...FULL_LABEL, baseProfileId: "pred" });
  expect(bounds(withDefault.inlayGeometry)).toEqual(bounds(without.inlayGeometry));
});
