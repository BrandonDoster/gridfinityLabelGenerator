import type { LabelInput } from "../types/label";
import { DEFAULT_PROFILE_ID } from "./profiles";

const THREE_MF_MIME = "model/3mf";

/**
 * Zip a batch off the main thread. fflate's async `zip` spins up a worker, so
 * deflating fifteen 3MFs no longer blocks paint and the export button's
 * spinner keeps spinning. (The single-3MF write in threeMfExporter stays
 * synchronous — one small file, inside the per-label work.)
 *
 * Level 6 rather than 9: 3MF XML and PNG both land within a fraction of a
 * percent either way, and 9 costs several times the CPU for it.
 *
 * fflate is dynamic-imported rather than imported at the top: this module is
 * loaded eagerly by App, and fflate's async `zip` inlines its worker source,
 * so a static import drags ~1.3 KB gzip of it into the main chunk. Same
 * reasoning as loadGenerator below — nothing here is needed until a click.
 */
async function zipAsync(files: Record<string, Uint8Array>): Promise<Blob> {
  const { zip } = await import("fflate");
  return new Promise((resolve, reject) => {
    zip(files, { level: 6 }, (err, data) => {
      if (err) return reject(err);
      // Copy out to a plain ArrayBuffer: fflate types its output as
      // Uint8Array<ArrayBufferLike>, which BlobPart won't take.
      const buf = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
      resolve(new Blob([buf], { type: "application/zip" }));
    });
  });
}

// Dynamic-import the heavy generator pipeline (Three.js + fflate + our
// labelGenerator + threeMfExporter) so it's code-split into its own chunk.
// Only fetched when the user actually clicks Download, so a visitor who never
// exports never pays for Three.js. Subsequent calls hit the browser's module
// cache instantly.
async function loadGenerator() {
  const [{ buildLabelMeshes }, { buildThreeMf }] = await Promise.all([
    import("./labelGenerator"),
    import("./threeMfExporter"),
  ]);
  return { buildLabelMeshes, buildThreeMf };
}

async function generateLabel3mf(label: LabelInput): Promise<ArrayBuffer> {
  const { buildLabelMeshes, buildThreeMf } = await loadGenerator();
  const { baseGeometry, inlayGeometry } = await buildLabelMeshes(label);
  return buildThreeMf({
    title: label.title,
    // Default AMS slot assignment: body = slot 1, inlay = slot 2. Bambu / Orca
    // auto-assign whatever the user has loaded in those slots, so a user with
    // black + red filaments gets a black body + red text/icon out of the box
    // (and a single-filament user falls back to slot 1 for both, no error).
    parts: [
      { geometry: baseGeometry, name: "Label Body", extruder: 1 },
      { geometry: inlayGeometry, name: "Text & Icons", extruder: 2 },
    ],
  });
}

function slugify(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "label";
}

export async function downloadSingle(label: LabelInput): Promise<Blob> {
  const buffer = await generateLabel3mf(label);
  return new Blob([buffer], { type: THREE_MF_MIME });
}

export async function downloadBatch(labels: LabelInput[]): Promise<{ blob: Blob; isZip: boolean }> {
  if (labels.length === 1) {
    return { blob: await downloadSingle(labels[0]), isZip: false };
  }

  const files: Record<string, Uint8Array> = {};
  const used = new Set<string>();
  for (const label of labels) {
    const buffer = await generateLabel3mf(label);
    // Must be the same fallback getProfile() uses, or the filename names a base
    // the file was not generated from.
    files[uniqueName(`${slugify(label.title)}-${label.baseProfileId ?? DEFAULT_PROFILE_ID}.3mf`, used)] =
      new Uint8Array(buffer);
  }
  return { blob: await zipAsync(files), isZip: true };
}

// PNG export — the lightweight pngExporter (no Three.js) is code-split into its
// own chunk, fetched on first PNG download. Mirrors the 3MF download shape.
export async function downloadSinglePng(label: LabelInput): Promise<Blob> {
  const { buildLabelPng } = await import("./pngExporter");
  return buildLabelPng(label);
}

export async function downloadBatchPng(labels: LabelInput[]): Promise<{ blob: Blob; isZip: boolean }> {
  const { buildLabelPng } = await import("./pngExporter");
  if (labels.length === 1) {
    return { blob: await buildLabelPng(labels[0]), isZip: false };
  }

  const files: Record<string, Uint8Array> = {};
  const used = new Set<string>();
  for (const label of labels) {
    const png = await buildLabelPng(label);
    files[uniqueName(`${slugify(label.title)}-png.png`, used)] = new Uint8Array(await png.arrayBuffer());
  }
  return { blob: await zipAsync(files), isZip: true };
}

function uniqueName(name: string, used: Set<string>): string {
  if (!used.has(name)) {
    used.add(name);
    return name;
  }
  const dot = name.lastIndexOf(".");
  const stem = dot === -1 ? name : name.slice(0, dot);
  const ext = dot === -1 ? "" : name.slice(dot);
  for (let i = 2; i < 1000; i++) {
    const candidate = `${stem}-${i}${ext}`;
    if (!used.has(candidate)) {
      used.add(candidate);
      return candidate;
    }
  }
  used.add(name);
  return name;
}
