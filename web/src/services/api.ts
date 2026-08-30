import { zipSync } from "fflate";
import type { LabelInput } from "../types/label";

const THREE_MF_MIME = "model/3mf";

// Dynamic-import the heavy generator pipeline (Three.js + fflate + our
// labelGenerator + threeMfExporter) so it's code-split into its own chunk.
// Only fetched when the user actually clicks Download — see D-020.
// Subsequent calls hit the browser's module cache instantly.
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
    files[uniqueName(`${slugify(label.title)}-${label.baseProfileId ?? "pred"}.3mf`, used)] = new Uint8Array(buffer);
  }
  const zipped = zipSync(files, { level: 9 });
  const zipBuf = zipped.buffer.slice(zipped.byteOffset, zipped.byteOffset + zipped.byteLength) as ArrayBuffer;
  return { blob: new Blob([zipBuf], { type: "application/zip" }), isZip: true };
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
  const zipped = zipSync(files, { level: 9 });
  const zipBuf = zipped.buffer.slice(zipped.byteOffset, zipped.byteOffset + zipped.byteLength) as ArrayBuffer;
  return { blob: new Blob([zipBuf], { type: "application/zip" }), isZip: true };
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
