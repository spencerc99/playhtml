/**
 * Routefinding over the road network. Road weight is how many real journeys
 * used that pavement, so a route is a claim about how people actually go.
 *
 * The four modes differ only in what an edge costs.
 */
import { Arrays } from "./data";

export interface RoadGraph {
  /** CSR adjacency over settlements */
  start: Int32Array;
  to: Int32Array;
  edge: Int32Array;      // index into road_a/road_b/road_w
  len: Float32Array;     // world length per road segment
  w: Float32Array;       // traversals per road segment
  /** normalised 0..1 traffic, for cost functions */
  busy: Float32Array;
}

export function buildRoadGraph(A: Arrays): RoadGraph {
  const ra = A.road_a as Uint32Array, rb = A.road_b as Uint32Array;
  const rw = A.road_w as Float32Array;
  const sx = A.sub_x as Float32Array, sy = A.sub_y as Float32Array;
  const n = sx.length, m = ra.length;

  const len = new Float32Array(m);
  let maxw = 1;
  for (let i = 0; i < m; i++) {
    len[i] = Math.hypot(sx[ra[i]] - sx[rb[i]], sy[ra[i]] - sy[rb[i]]);
    if (rw[i] > maxw) maxw = rw[i];
  }
  const lg = Math.log1p(maxw) || 1;
  const busy = new Float32Array(m);
  for (let i = 0; i < m; i++) busy[i] = Math.log1p(rw[i]) / lg;

  const deg = new Int32Array(n);
  for (let i = 0; i < m; i++) { deg[ra[i]]++; deg[rb[i]]++; }
  const start = new Int32Array(n + 1);
  for (let i = 0; i < n; i++) start[i + 1] = start[i] + deg[i];
  const to = new Int32Array(m * 2), edge = new Int32Array(m * 2);
  const at = start.slice(0, n);
  for (let i = 0; i < m; i++) {
    to[at[ra[i]]] = rb[i]; edge[at[ra[i]]++] = i;
    to[at[rb[i]]] = ra[i]; edge[at[rb[i]]++] = i;
  }
  return { start, to, edge, len, w: rw, busy };
}

export type Mode = "fast" | "short" | "scenic" | "quiet";

export const MODES: { id: Mode; name: string; blurb: string }[] = [
  { id: "fast", name: "fastest", blurb: "the way most people actually go" },
  { id: "short", name: "shortest", blurb: "least ground covered" },
  { id: "scenic", name: "scenic", blurb: "the back roads, through open country" },
  { id: "quiet", name: "quietest", blurb: "avoids whatever everyone else is on" },
];

/** Edge cost per mode: fast divides by traffic, quiet and scenic multiply. */
function costFn(g: RoadGraph, mode: Mode): (e: number) => number {
  const { len, busy } = g;
  switch (mode) {
    case "short": return (e) => len[e];
    case "fast": return (e) => len[e] / (0.35 + 2.2 * busy[e]);
    case "quiet": return (e) => len[e] * (0.5 + 3.5 * busy[e]);
    case "scenic": return (e) => len[e] * (0.5 + 2.5 * busy[e]) * 0.9;
  }
}

export interface Route {
  mode: Mode;
  nodes: number[];        // settlements, in order
  edges: number[];        // road segments, in order
  length: number;         // world units
  busiest: number;        // peak normalised traffic on the way
  ok: boolean;
}

/** Dijkstra with a binary heap. The graph is ~50k nodes, so this is instant. */
export function findRoute(g: RoadGraph, from: number, to: number, mode: Mode): Route {
  const n = g.start.length - 1;
  const empty: Route = { mode, nodes: [], edges: [], length: 0, busiest: 0, ok: false };
  if (from === to || from < 0 || to < 0 || from >= n || to >= n) return empty;

  const cost = costFn(g, mode);
  const dist = new Float64Array(n).fill(Infinity);
  const prev = new Int32Array(n).fill(-1);
  const prevEdge = new Int32Array(n).fill(-1);
  const heap: number[] = [from];
  const key = new Float64Array(n).fill(Infinity);
  dist[from] = 0; key[from] = 0;

  const swap = (i: number, j: number) => { const t = heap[i]; heap[i] = heap[j]; heap[j] = t; };
  const up = (i: number) => {
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (key[heap[p]] <= key[heap[i]]) break;
      swap(p, i); i = p;
    }
  };
  const down = (i: number) => {
    for (;;) {
      const l = 2 * i + 1, r = l + 1;
      let s = i;
      if (l < heap.length && key[heap[l]] < key[heap[s]]) s = l;
      if (r < heap.length && key[heap[r]] < key[heap[s]]) s = r;
      if (s === i) break;
      swap(s, i); i = s;
    }
  };

  while (heap.length) {
    const u = heap[0];
    heap[0] = heap[heap.length - 1]; heap.pop();
    if (heap.length) down(0);
    if (u === to) break;
    const du = dist[u];
    if (key[u] < du) continue;
    for (let k = g.start[u]; k < g.start[u + 1]; k++) {
      const e = g.edge[k], v = g.to[k];
      const nd = du + cost(e);
      if (nd < dist[v]) {
        dist[v] = nd; prev[v] = u; prevEdge[v] = e; key[v] = nd;
        heap.push(v); up(heap.length - 1);
      }
    }
  }
  if (!Number.isFinite(dist[to])) return empty;

  const nodes: number[] = [], edges: number[] = [];
  for (let v = to; v !== -1; v = prev[v]) {
    nodes.push(v);
    if (prevEdge[v] >= 0) edges.push(prevEdge[v]);
    if (v === from) break;
  }
  nodes.reverse(); edges.reverse();
  let length = 0, busiest = 0;
  for (const e of edges) { length += g.len[e]; if (g.busy[e] > busiest) busiest = g.busy[e]; }
  return { mode, nodes, edges, length, busiest, ok: nodes.length > 1 };
}


/**
 * Where the journey stops. Driving past a building is not visiting it, so a
 * stop is an end, a place big enough to be a destination, or a junction where
 * the route leaves one road for another.
 */
export function stopsAlong(
  g: RoadGraph, r: Route, sx: Float32Array, sy: Float32Array,
  pages: Uint32Array, minPages = 60, turnDeg = 40,
): number[] {
  const n = r.nodes.length;
  if (n < 2) return r.nodes.slice();
  const deg = (i: number) => g.start[i + 1] - g.start[i];
  const out: number[] = [r.nodes[0]];
  const turn = Math.cos((turnDeg * Math.PI) / 180);
  for (let k = 1; k < n - 1; k++) {
    const p = r.nodes[k - 1], c = r.nodes[k], q = r.nodes[k + 1];
    const notable = pages[c] >= minPages;
    let corner = false;
    if (deg(c) >= 3) {
      const ax = sx[c] - sx[p], ay = sy[c] - sy[p];
      const bx = sx[q] - sx[c], by = sy[q] - sy[c];
      const la = Math.hypot(ax, ay) || 1, lb = Math.hypot(bx, by) || 1;
      corner = (ax * bx + ay * by) / (la * lb) < turn;
    }
    if (notable || corner) out.push(c);
  }
  out.push(r.nodes[n - 1]);
  return out;
}
