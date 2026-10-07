/** Loading and typed-array views over the binary map artifact. */

export type Arrays = Record<string, Float32Array | Uint32Array | Uint16Array | Uint8Array>;

export interface Header {
  counts: {
    pages: number; subs: number; doms: number;
    page_edges: number; sub_edges: number; dom_edges: number; roads: number;
  };
  totals: Record<string, number>;
  extent: [number, number, number, number];
  focus?: [number, number, number, number];
  arrays: Record<string, { off: number; len: number; type: string }>;
  categories: string[];
}

export interface Labels {
  pages: string[];
  titles: string[];
  subs: string[];
  doms: string[];
  favicons: Record<string, string>;
}

export interface MapData {
  head: Header;
  A: Arrays;
  labels: Labels;
  /** log-normalised visit count per page, 0..1 */
  pageI: Float32Array;
  maxHits: number;
}

/**
 * Some servers (Vite among them) send .gz with `Content-Encoding: gzip`, so the
 * browser has already inflated it by the time we see the body; others send it
 * as opaque bytes. Sniff the gzip magic instead of trusting either.
 */
async function loadMaybeGzipped(url: string): Promise<any> {
  const buf = await (await fetch(url)).arrayBuffer();
  const head = new Uint8Array(buf, 0, Math.min(2, buf.byteLength));
  const text = head[0] === 0x1f && head[1] === 0x8b
    ? await new Response(
        new Blob([buf]).stream().pipeThrough(new DecompressionStream("gzip")),
      ).text()
    : new TextDecoder().decode(buf);
  return JSON.parse(text);
}

const CTOR: Record<string, any> = {
  float32: Float32Array, uint32: Uint32Array,
  uint16: Uint16Array, uint8: Uint8Array,
};

export async function loadMap(
  dir: string,
  onProgress: (msg: string, pct: number) => void,
): Promise<MapData> {
  onProgress("header", 0.05);
  const headRes = await fetch(`${dir}/map.json`);
  // A missing bundle comes back as the SPA's HTML fallback, not a 404.
  if (!headRes.ok || (headRes.headers.get("content-type") ?? "").includes("text/html")) {
    throw new Error(`no map bundle at ${dir}`);
  }
  const head: Header = await headRes.json();

  onProgress("positions", 0.15);
  const bin = await (await fetch(`${dir}/map.bin`)).arrayBuffer();

  onProgress("labels", 0.55);
  const labels: Labels = await loadMaybeGzipped(`${dir}/labels.json.gz`);

  onProgress("indexing", 0.85);
  const A: Arrays = {};
  for (const [k, v] of Object.entries(head.arrays)) {
    A[k] = new CTOR[v.type](bin, v.off, v.len);
  }

  const hits = A.page_hits as Uint32Array;
  let maxHits = 1;
  for (let i = 0; i < hits.length; i++) if (hits[i] > maxHits) maxHits = hits[i];
  const lg = Math.log1p(maxHits);
  const pageI = new Float32Array(hits.length);
  for (let i = 0; i < hits.length; i++) pageI[i] = Math.log1p(hits[i]) / lg;

  return { head, A, labels, pageI, maxHits };
}

/** CSR adjacency over the exported page jumps, for the detail panel. */
