import { describe, expect, it } from "vitest";
import type { BaseStlProfileId } from "../src/types/label";
import { buildLabelMeshes } from "../src/services/labelGenerator";
import { buildThreeMf } from "../src/services/threeMfExporter";
import { FULL_LABEL, parseXml, triangleCount, unzipText } from "./helpers";

const MODEL = "3D/3dmodel.model";
const CONFIG = "Metadata/model_settings.config";

// Same two parts api.ts ships: body on AMS slot 1, inlay on slot 2.
const cache = new Map<string, Awaited<ReturnType<typeof build>>>();

async function build(id: BaseStlProfileId, title: string) {
  const { baseGeometry, inlayGeometry } = await buildLabelMeshes({ ...FULL_LABEL, title, baseProfileId: id });
  const buffer = buildThreeMf({
    title,
    parts: [
      { geometry: baseGeometry, name: "Label Body", extruder: 1 },
      { geometry: inlayGeometry, name: "Text & Icons", extruder: 2 },
    ],
  });
  const files = unzipText(buffer);
  // Parsed once and reused: these documents carry tens of thousands of
  // triangles, so re-parsing per assertion dominates the suite's runtime.
  return { buffer, files, model: parseXml(files[MODEL]), config: parseXml(files[CONFIG]), baseGeometry, inlayGeometry };
}

async function exportLabel(id: BaseStlProfileId, title = FULL_LABEL.title) {
  const key = `${id}|${title}`;
  if (!cache.has(key)) cache.set(key, await build(id, title));
  return cache.get(key)!;
}

const tags = (root: Document | Element, name: string) => Array.from(root.getElementsByTagName(name));

describe.each<BaseStlProfileId>(["pred", "cullenect"])("3MF package (%s)", (id) => {
  it("is a valid 3MF package: the four parts a slicer opens", async () => {
    const { files } = await exportLabel(id);
    expect(Object.keys(files).sort()).toEqual(
      ["[Content_Types].xml", "_rels/.rels", MODEL, CONFIG].sort(),
    );
    // Content types must cover every extension actually in the package.
    const types = parseXml(files["[Content_Types].xml"]);
    expect(tags(types, "Default").map((d) => d.getAttribute("Extension")).sort())
      .toEqual(["config", "model", "rels"]);
    // The package relationship is what points a slicer at the model.
    const rels = parseXml(files["_rels/.rels"]);
    expect(tags(rels, "Relationship")[0].getAttribute("Target")).toBe(`/${MODEL}`);
  });

  it("declares millimetres, two named objects and an assembly the build points at", async () => {
    const { model, baseGeometry, inlayGeometry } = await exportLabel(id);

    // Everything downstream (box sizes, emboss height) is in mm.
    expect(model.documentElement.getAttribute("unit")).toBe("millimeter");

    const objects = tags(model, "object");
    expect(objects.map((o) => o.getAttribute("name"))).toEqual([
      "Label Body",
      "Text & Icons",
      FULL_LABEL.title,
    ]);
    expect(objects.map((o) => o.getAttribute("id"))).toEqual(["1", "2", "3"]);

    // Exactly two leaf meshes; the third object is the components assembly.
    expect(objects.filter((o) => o.getElementsByTagName("mesh").length === 1)).toHaveLength(2);
    const assembly = objects[2];
    expect(tags(assembly, "component").map((c) => c.getAttribute("objectid"))).toEqual(["1", "2"]);

    // One build item, and it references the assembly rather than a leaf — that
    // is what gives slicers "one model, two named children".
    const items = tags(model, "item");
    expect(items).toHaveLength(1);
    expect(items[0].getAttribute("objectid")).toBe(assembly.getAttribute("id"));

    // The meshes really carry the geometry that was handed in.
    const meshes = tags(model, "mesh");
    for (const [i, geo] of [baseGeometry, inlayGeometry].entries()) {
      expect(meshes[i].getElementsByTagName("vertex")).toHaveLength(geo.getAttribute("position").count);
      expect(meshes[i].getElementsByTagName("triangle")).toHaveLength(triangleCount(geo));
    }
  });

  it("assigns body to extruder 1 and inlay to extruder 2 in the Bambu config", async () => {
    const { config } = await exportLabel(id);
    // The config hangs off the assembly object, not the leaves.
    expect(tags(config, "object")[0].getAttribute("id")).toBe("3");
    const parts = tags(config, "part");
    expect(parts.map((p) => p.getAttribute("id"))).toEqual(["1", "2"]);
    const meta = (p: Element, key: string) =>
      Array.from(p.getElementsByTagName("metadata")).find((m) => m.getAttribute("key") === key)
        ?.getAttribute("value");
    expect(parts.map((p) => meta(p, "name"))).toEqual(["Label Body", "Text & Icons"]);
    expect(parts.map((p) => meta(p, "extruder"))).toEqual(["1", "2"]);
  });

  it("never emits a triangle referencing a vertex it did not write", async () => {
    const { model } = await exportLabel(id);
    for (const mesh of tags(model, "mesh")) {
      const vertexCount = mesh.getElementsByTagName("vertex").length;
      const bad = tags(mesh, "triangle").filter((t) =>
        ["v1", "v2", "v3"].some((v) => {
          const n = Number(t.getAttribute(v));
          return !Number.isInteger(n) || n < 0 || n >= vertexCount;
        }),
      );
      expect(bad).toHaveLength(0);
    }
  });
});

// threeMfExporter.escapeXml, exercised through the only path that can ship a
// user string: the label title, which lands in four different places.
it("escapes XML metacharacters in the title instead of emitting broken XML", async () => {
  const title = `Nuts & <Bolts> "M3" 'x10'`;
  const { files, model, config } = await exportLabel("cullenect", title);

  // parseXml throws on a parser error, so simply getting the documents back
  // proves both are well-formed with the raw & < > " ' in the title.

  expect(files[MODEL]).toContain("&amp;");
  expect(files[MODEL]).not.toContain("<Bolts>");

  // Round-trips: what a slicer reads back is exactly what the user typed.
  const titleMeta = Array.from(model.getElementsByTagName("metadata")).find(
    (m) => m.getAttribute("name") === "Title",
  );
  expect(titleMeta?.textContent).toBe(title);
  expect(Array.from(model.getElementsByTagName("object")).at(-1)?.getAttribute("name")).toBe(title);
  expect(config.getElementsByTagName("metadata")[0].getAttribute("value")).toBe(title);
});
