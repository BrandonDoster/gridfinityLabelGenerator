import { BufferAttribute, BufferGeometry } from "three";
import type { ManifoldToplevel } from "manifold-3d";

// CSG (constructive solid geometry) wrapper around manifold-3d. Only loaded
// on first flush-mode export — the manifold-3d JS module (~71 KB) and its
// wasm payload (~482 KB) are dynamic-imported behind this module's API.
//
// Both dynamic imports below (the JS module and the wasm `?url`) tell Vite
// to code-split everything reachable from here into a separate chunk. The
// chunk doesn't fetch until subtract() is actually called. See
// fork_decisions.md §D-001, D-007, D-021.

let runtimePromise: Promise<ManifoldToplevel> | null = null;

async function loadRuntime(): Promise<ManifoldToplevel> {
  if (runtimePromise) return runtimePromise;
  const promise = (async () => {
    const [{ default: Module }, { default: wasmUrl }] = await Promise.all([
      import("manifold-3d"),
      // Vite asset import: emits the .wasm into the build and gives us its URL.
      // Path resolves via manifold-3d's package "exports" map.
      import("manifold-3d/manifold.wasm?url"),
    ]);
    const runtime = await Module({ locateFile: () => wasmUrl });
    runtime.setup();
    return runtime;
  })();
  // Evict on rejection: a cached rejected promise would make every later flush
  // export re-throw the stale wasm-fetch error until the page reloads. The
  // caller still gets the original rejection — see loadFont in labelGenerator.
  promise.catch(() => {
    if (runtimePromise === promise) runtimePromise = null;
  });
  runtimePromise = promise;
  return promise;
}

/**
 * Boolean difference: `base - tool`. Both inputs must be **manifold** (closed,
 * watertight) — manifold-3d will throw "input is not 2-manifold" otherwise.
 *
 * Returns a fresh BufferGeometry with positions + index, no other attributes.
 * Caller should run mergeVertices() on the result if downstream code expects
 * deduped indexed geometry (manifold-3d does its own internal merging, but
 * float-precision can leave near-duplicates).
 */
export async function subtract(
  baseGeo: BufferGeometry,
  toolGeo: BufferGeometry,
): Promise<BufferGeometry> {
  const runtime = await loadRuntime();
  const baseMesh = toManifoldMesh(runtime, baseGeo);
  const toolMesh = toManifoldMesh(runtime, toolGeo);
  const baseManifold = new runtime.Manifold(baseMesh);
  const toolManifold = new runtime.Manifold(toolMesh);
  try {
    const result = baseManifold.subtract(toolManifold);
    try {
      return fromManifoldMesh(result.getMesh());
    } finally {
      result.delete();
    }
  } finally {
    baseManifold.delete();
    toolManifold.delete();
  }
}

function toManifoldMesh(runtime: ManifoldToplevel, geo: BufferGeometry) {
  const position = geo.getAttribute("position");
  if (!position) {
    throw new Error("CSG input geometry is missing a position attribute");
  }
  // Manifold expects Float32Array verts. Three.js position attributes are
  // already Float32Array for buffer geometries built by ExtrudeGeometry /
  // STLLoader, but copy defensively so manifold owns its memory.
  const vertProperties = new Float32Array(position.array as Float32Array);
  let triVerts: Uint32Array;
  if (geo.index) {
    triVerts = new Uint32Array(geo.index.array);
  } else {
    // Non-indexed input: every 3 sequential vertices form one triangle.
    triVerts = new Uint32Array(position.count);
    for (let i = 0; i < position.count; i++) triVerts[i] = i;
  }
  return new runtime.Mesh({ numProp: 3, vertProperties, triVerts });
}

function fromManifoldMesh(mesh: {
  numProp: number;
  vertProperties: Float32Array;
  triVerts: Uint32Array;
}): BufferGeometry {
  const out = new BufferGeometry();
  // Manifold returns interleaved vertex properties; the first three are x,y,z.
  // We only request numProp=3 in toManifoldMesh, so output numProp should also
  // be 3, but extract defensively.
  const numProp = mesh.numProp || 3;
  let positionArray: Float32Array;
  if (numProp === 3) {
    positionArray = new Float32Array(mesh.vertProperties);
  } else {
    const numVerts = mesh.vertProperties.length / numProp;
    positionArray = new Float32Array(numVerts * 3);
    for (let i = 0; i < numVerts; i++) {
      positionArray[i * 3] = mesh.vertProperties[i * numProp];
      positionArray[i * 3 + 1] = mesh.vertProperties[i * numProp + 1];
      positionArray[i * 3 + 2] = mesh.vertProperties[i * numProp + 2];
    }
  }
  out.setAttribute("position", new BufferAttribute(positionArray, 3));
  out.setIndex(new BufferAttribute(new Uint32Array(mesh.triVerts), 1));
  return out;
}
