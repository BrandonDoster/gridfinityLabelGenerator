import { zipSync, strToU8 } from "fflate";
import type { BufferGeometry } from "three";

// Hand-rolled 3MF writer. Spec: https://3mf.io/spec/
// File structure (everything below is zipped into a single .3mf file):
//   [Content_Types].xml      describes MIME types of internal parts
//   _rels/.rels              relationship from package → 3D model
//   3D/3dmodel.model         the model XML (vertices, triangles, build)
//
// Slicer outline produced:
//   <assembly>
//     ├─ Label Body   (first part)
//     └─ Text & Icons (second part — disconnected letter/icon triangles
//                      all live in the same <mesh>, so the slicer treats
//                      them as one paintable child rather than 50 parts)
//
// Why one merged mesh for inlays: see fork_decisions.md §D-006.
// Why the components-assembly structure: see fork_decisions.md §D-005.

const NS_3MF_CORE = "http://schemas.microsoft.com/3dmanufacturing/core/2015/02";
const NS_RELS = "http://schemas.openxmlformats.org/package/2006/relationships";
const NS_CONTENT_TYPES = "http://schemas.openxmlformats.org/package/2006/content-types";
const REL_TYPE_3DMODEL = "http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel";
const CT_3DMODEL = "application/vnd.ms-package.3dmanufacturing-3dmodel+xml";
const CT_RELS = "application/vnd.openxmlformats-package.relationships+xml";

interface ThreeMfPart {
  geometry: BufferGeometry;
  name: string;
  /**
   * 1-indexed filament slot the slicer should auto-assign this part to (Bambu
   * Studio / OrcaSlicer). NOT a specific filament — just the AMS slot number,
   * so users get whatever they have loaded in slots 1, 2, … by default. Omit
   * for "let the slicer assign whatever default".
   *
   * If the user has fewer filaments loaded than the highest slot referenced,
   * Bambu/Orca falls back to slot 1 with a non-blocking warning.
   *
   * Honored by Bambu Studio + OrcaSlicer via Metadata/model_settings.config.
   * Ignored harmlessly by PrusaSlicer (different config schema) and Cura.
   */
  extruder?: number;
}

interface ThreeMfInput {
  title: string;
  parts: ThreeMfPart[];
}

export function buildThreeMf(input: ThreeMfInput): ArrayBuffer {
  const usableParts = input.parts.filter((p) => geometryHasTriangles(p.geometry));
  if (usableParts.length === 0) {
    throw new Error("3MF export requires at least one part with geometry");
  }

  const modelXml = buildModelXml(input.title, usableParts);
  const contentTypesXml = buildContentTypesXml();
  const relsXml = buildRelsXml();
  const bambuConfigXml = buildBambuModelSettingsXml(input.title, usableParts);

  const zipped = zipSync(
    {
      "[Content_Types].xml": strToU8(contentTypesXml),
      "_rels/.rels": strToU8(relsXml),
      "3D/3dmodel.model": strToU8(modelXml),
      // Bambu Studio (and OrcaSlicer, a Bambu fork) read part names from this
      // file rather than the 3MF Core <object name="…"> attribute. Other slicers
      // ignore it harmlessly. See fork_decisions.md §D-012.
      "Metadata/model_settings.config": strToU8(bambuConfigXml),
    },
    { level: 9 },
  );

  return zipped.buffer.slice(zipped.byteOffset, zipped.byteOffset + zipped.byteLength) as ArrayBuffer;
}

function geometryHasTriangles(geo: BufferGeometry): boolean {
  const position = geo.getAttribute("position");
  if (!position || position.count === 0) return false;
  if (geo.index) return geo.index.count >= 3;
  return position.count >= 3;
}

function buildContentTypesXml(): string {
  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<Types xmlns="${NS_CONTENT_TYPES}">`,
    `  <Default Extension="rels" ContentType="${CT_RELS}"/>`,
    `  <Default Extension="model" ContentType="${CT_3DMODEL}"/>`,
    `  <Default Extension="config" ContentType="text/xml"/>`,
    `</Types>`,
  ].join("\n");
}

// Bambu Studio / OrcaSlicer per-part metadata file. Schema follows the
// convention used by Bambu's own exporter: one <object> per build assembly,
// with <part> children indexed by 3MF object id. We always emit "normal_part"
// here; subtype="negative_part" is what Stage 4's flush mode could use as an
// alternative to CSG, but D-001 picks manifold-3d CSG instead for slicer
// portability.
function buildBambuModelSettingsXml(title: string, parts: ThreeMfPart[]): string {
  const assemblyId = parts.length + 1;
  const identityMatrix = "1 0 0 0 0 1 0 0 0 0 1 0 0 0 0 1";
  const out: string[] = [];
  out.push(`<?xml version="1.0" encoding="UTF-8"?>`);
  out.push(`<config>`);
  out.push(`  <object id="${assemblyId}">`);
  out.push(`    <metadata key="name" value="${escapeXml(title)}"/>`);
  parts.forEach((part, i) => {
    const id = i + 1;
    out.push(`    <part id="${id}" subtype="normal_part">`);
    out.push(`      <metadata key="name" value="${escapeXml(part.name)}"/>`);
    out.push(`      <metadata key="matrix" value="${identityMatrix}"/>`);
    if (part.extruder !== undefined) {
      out.push(`      <metadata key="extruder" value="${part.extruder}"/>`);
    }
    out.push(`    </part>`);
  });
  out.push(`  </object>`);
  out.push(`</config>`);
  return out.join("\n");
}

function buildRelsXml(): string {
  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<Relationships xmlns="${NS_RELS}">`,
    `  <Relationship Id="rel0" Target="/3D/3dmodel.model" Type="${REL_TYPE_3DMODEL}"/>`,
    `</Relationships>`,
  ].join("\n");
}

function buildModelXml(title: string, parts: ThreeMfPart[]): string {
  const out: string[] = [];
  out.push(`<?xml version="1.0" encoding="UTF-8"?>`);
  out.push(
    `<model unit="millimeter" xml:lang="en-US" xmlns="${NS_3MF_CORE}">`,
  );
  out.push(`  <metadata name="Title">${escapeXml(title)}</metadata>`);
  out.push(`  <metadata name="Application">gridfinity-label-generator</metadata>`);
  out.push(`  <resources>`);

  parts.forEach((part, i) => {
    const id = i + 1;
    appendObject(out, id, part.name, part.geometry, "    ");
  });

  const assemblyId = parts.length + 1;
  out.push(`    <object id="${assemblyId}" type="model" name="${escapeXml(title)}">`);
  out.push(`      <components>`);
  parts.forEach((_, i) => {
    out.push(`        <component objectid="${i + 1}"/>`);
  });
  out.push(`      </components>`);
  out.push(`    </object>`);

  out.push(`  </resources>`);
  out.push(`  <build>`);
  out.push(`    <item objectid="${assemblyId}"/>`);
  out.push(`  </build>`);
  out.push(`</model>`);
  return out.join("\n");
}

function appendObject(
  out: string[],
  id: number,
  name: string,
  geo: BufferGeometry,
  indent: string,
): void {
  out.push(`${indent}<object id="${id}" type="model" name="${escapeXml(name)}">`);
  out.push(`${indent}  <mesh>`);
  appendVertices(out, geo, `${indent}    `);
  appendTriangles(out, geo, `${indent}    `);
  out.push(`${indent}  </mesh>`);
  out.push(`${indent}</object>`);
}

function appendVertices(out: string[], geo: BufferGeometry, indent: string): void {
  const position = geo.getAttribute("position")!;
  out.push(`${indent}<vertices>`);
  for (let i = 0; i < position.count; i++) {
    const x = formatCoord(position.getX(i));
    const y = formatCoord(position.getY(i));
    const z = formatCoord(position.getZ(i));
    out.push(`${indent}  <vertex x="${x}" y="${y}" z="${z}"/>`);
  }
  out.push(`${indent}</vertices>`);
}

function appendTriangles(out: string[], geo: BufferGeometry, indent: string): void {
  out.push(`${indent}<triangles>`);
  if (geo.index) {
    const arr = geo.index.array;
    for (let i = 0; i + 2 < arr.length; i += 3) {
      out.push(`${indent}  <triangle v1="${arr[i]}" v2="${arr[i + 1]}" v3="${arr[i + 2]}"/>`);
    }
  } else {
    const position = geo.getAttribute("position")!;
    for (let i = 0; i + 2 < position.count; i += 3) {
      out.push(`${indent}  <triangle v1="${i}" v2="${i + 1}" v3="${i + 2}"/>`);
    }
  }
  out.push(`${indent}</triangles>`);
}

// 4 decimals = 0.1 µm precision — well below printer resolution, keeps file size sane
function formatCoord(value: number): string {
  if (!Number.isFinite(value)) return "0";
  return value.toFixed(4);
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
