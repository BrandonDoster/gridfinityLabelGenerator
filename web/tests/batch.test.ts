import { describe, expect, it, vi } from "vitest";
import { unzipSync } from "fflate";
import type { LabelInput } from "../src/types/label";
import { downloadBatch, downloadBatchPng, downloadSingle } from "../src/services/api";
import { DEFAULT_PROFILE_ID } from "../src/services/profiles";
import { FULL_LABEL, unzipText } from "./helpers";

// The PNG path needs a canvas to rasterize, which node/jsdom don't have. Stub
// the raster step only — the naming, de-duplication and zipping under test all
// live in api.ts, not in the exporter.
vi.mock("../src/services/pngExporter", () => ({
  buildLabelPng: async (label: LabelInput) => new Blob([`png:${label.title}`], { type: "image/png" }),
}));

const label = (title: string, extra: Partial<LabelInput> = {}): LabelInput => ({
  ...FULL_LABEL,
  title,
  ...extra,
});

async function entries(blob: Blob): Promise<Record<string, Uint8Array>> {
  return unzipSync(new Uint8Array(await blob.arrayBuffer()));
}

describe("3MF batch download", () => {
  it("returns a bare 3MF, not a zip, for a single label", async () => {
    const { blob, isZip } = await downloadBatch([label("M3x10", { baseProfileId: "cullenect" })]);
    expect(isZip).toBe(false);
    expect(blob.type).toBe("model/3mf");
    // Still a real 3MF package, just not wrapped.
    expect(Object.keys(unzipText(await blob.arrayBuffer()))).toContain("3D/3dmodel.model");
  });

  it("zips several labels under <slug>-<profileId>.3mf", async () => {
    const { blob, isZip } = await downloadBatch([
      label("M3x10 Screw!", { baseProfileId: "pred" }),
      label("M4 Nut", { baseProfileId: "cullenect" }),
    ]);
    expect(isZip).toBe(true);
    expect(blob.type).toBe("application/zip");
    const files = await entries(blob);
    expect(Object.keys(files)).toEqual(["m3x10-screw-pred.3mf", "m4-nut-cullenect.3mf"]);
    // Each entry is itself a 3MF package.
    for (const data of Object.values(files)) {
      expect(Object.keys(unzipSync(data))).toContain("3D/3dmodel.model");
    }
  });

  it("de-duplicates colliding titles with -2, -3 rather than overwriting", async () => {
    const { blob } = await downloadBatch([
      label("M3x10", { baseProfileId: "pred" }),
      label("M3x10", { baseProfileId: "pred" }),
      label("M3x10", { baseProfileId: "pred" }),
    ]);
    const names = Object.keys(await entries(blob));
    expect(names).toEqual(["m3x10-pred.3mf", "m3x10-pred-2.3mf", "m3x10-pred-3.3mf"]);
    // Three labels in, three files out — nothing silently dropped.
    expect(new Set(names).size).toBe(3);
  });

  // Regression: the batch filename used the literal "pred" while getProfile()
  // fell back to DEFAULT_PROFILE_ID, so a label with no baseProfileId shipped a
  // cullenect body inside a file named "…-pred.3mf".
  it("names a label with no baseProfileId after the profile actually generated", async () => {
    const untyped = label("Default Base");
    expect(untyped.baseProfileId).toBeUndefined();

    const { blob } = await downloadBatch([untyped, label("Other")]);
    const files = await entries(blob);
    expect(Object.keys(files)[0]).toBe(`default-base-${DEFAULT_PROFILE_ID}.3mf`);

    // And the model under that name is the one the named profile produces.
    // (Compared as model XML, not raw zip bytes: zip entries carry an mtime.)
    const explicit = await downloadSingle({ ...untyped, baseProfileId: DEFAULT_PROFILE_ID });
    const model = (files3mf: Record<string, string>) => files3mf["3D/3dmodel.model"];
    expect(model(unzipText(files[`default-base-${DEFAULT_PROFILE_ID}.3mf`])))
      .toBe(model(unzipText(await explicit.arrayBuffer())));
  });
});

describe("PNG batch download", () => {
  it("returns a bare PNG, not a zip, for a single label", async () => {
    const { blob, isZip } = await downloadBatchPng([label("M3x10")]);
    expect(isZip).toBe(false);
    expect(blob.type).toBe("image/png");
  });

  it("zips several labels under <slug>-png.png, de-duplicating collisions", async () => {
    const { blob, isZip } = await downloadBatchPng([label("M3x10"), label("M4 Nut"), label("M3x10")]);
    expect(isZip).toBe(true);
    expect(Object.keys(await entries(blob))).toEqual([
      "m3x10-png.png",
      "m4-nut-png.png",
      "m3x10-png-2.png",
    ]);
  });

  it("falls back to 'label' for a title with nothing sluggable in it", async () => {
    const { blob } = await downloadBatchPng([label("!!!"), label("???")]);
    expect(Object.keys(await entries(blob))).toEqual(["label-png.png", "label-png-2.png"]);
  });
});
