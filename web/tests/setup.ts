import { readFile } from "node:fs/promises";
import { JSDOM } from "jsdom";

// loadFont/loadProfile fetch `${import.meta.env.BASE_URL}<asset>`. Serve those
// off disk from web/public instead of mocking the geometry: the real STL and
// the real font are the interesting part of every geometry assertion here.
const PUBLIC = new URL("../public/", import.meta.url);

export const publicFetch = (async (input: RequestInfo | URL) => {
  const name = String(input).split("/").pop()!;
  let body: Buffer;
  try {
    body = await readFile(new URL(name, PUBLIC));
  } catch {
    // Same shape as a browser network failure, not a 404 Response, so a typo in
    // an asset path fails loudly rather than looking like a served error page.
    throw new TypeError(`test fetch: no such file in web/public: ${name}`);
  }
  // Hand-rolled instead of `new Response`: only .ok/.json/.arrayBuffer are used,
  // and this works the same in the node and jsdom environments.
  return {
    ok: true,
    status: 200,
    json: async () => JSON.parse(body.toString("utf8")),
    arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength),
  };
}) as unknown as typeof fetch;

globalThis.fetch = publicFetch;

// Three's SVGLoader parses icon markup with DOMParser. The suite otherwise runs
// in the node environment (fflate's async zip wants worker_threads, not a Blob
// URL worker), so lend it just the parser rather than a whole DOM.
if (typeof globalThis.DOMParser === "undefined") {
  globalThis.DOMParser = new JSDOM().window.DOMParser;
}
