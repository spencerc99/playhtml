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
function modeCost(g: RoadGraph, mode: Mode): (e: number) => number {
  const { len, busy } = g;
  switch (mode) {
    case "short": return (e) => len[e];
    case "fast": return (e) => len[e] / (0.35 + 2.2 * busy[e]);
    case "quiet": return (e) => len[e] * (0.5 + 3.5 * busy[e]);
    case "scenic": return (e) => len[e] * (0.5 + 2.5 * busy[e]) * 0.9;
  }
}

/**
 * A road between two neighbourhoods of the same site costs this much more.
 * Most traffic inside a big site is people clicking from one of its pages to
 * the next, so its busiest roads run deep through it; a route that follows
 * them spends its whole length in one place. Where another way exists, this
 * tips the route towards the one that crosses between places instead.
 */
export const SAME_SITE_COST = 2.5;

function costFn(g: RoadGraph, mode: Mode, sites?: SiteIndex): (e: number) => number {
  const base = modeCost(g, mode);
  if (!sites) return base;
  const { site, roadA, roadB } = sites;
  return (e) => (site[roadA[e]] === site[roadB[e]] ? SAME_SITE_COST : 1) * base(e);
}

/**
 * The hostname each settlement belongs to, as an id. A label is
 * "host/path [n]": a big host is split into several neighbourhoods by path,
 * and a busy path further into numbered chunks.
 */
export function hostIds(subs: string[]): Int32Array {
  const ids = new Int32Array(subs.length);
  const seen = new Map<string, number>();
  for (let i = 0; i < subs.length; i++) {
    const h = subs[i].replace(/ \[\d+\]$/, "").split("/")[0];
    let v = seen.get(h);
    if (v === undefined) { v = seen.size; seen.set(h, v); }
    ids[i] = v;
  }
  return ids;
}

/**
 * What routing needs to know to prefer crossing between places: which site
 * (registrable domain) each settlement belongs to, so docs.google.com and
 * mail.google.com, or reddit.com and old.reddit.com, count as one place.
 */
export interface SiteIndex {
  site: ArrayLike<number>;
  roadA: Uint32Array;
  roadB: Uint32Array;
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
export function findRoute(g: RoadGraph, from: number, to: number, mode: Mode,
                          sites?: SiteIndex): Route {
  const n = g.start.length - 1;
  const empty: Route = { mode, nodes: [], edges: [], length: 0, busiest: 0, ok: false };
  if (from === to || from < 0 || to < 0 || from >= n || to >= n) return empty;

  const cost = costFn(g, mode, sites);
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


/** Per-settlement facts the stop picker weighs, built once at load. */
export interface Places {
  /** the site each settlement belongs to (its domain, as sub_dom gives it) */
  site: ArrayLike<number>;
  /** the hostname each settlement belongs to, for naming stops */
  host: Int32Array;
  /** pages in each settlement */
  pages: ArrayLike<number>;
  /** pages in each site, over all its neighbourhoods */
  sitePages: Float64Array;
  /** each settlement's label without its chunk marker: "host/path" */
  names: string[];
}

/** `site` defaults to the hostname when no domain grouping is given. */
export function buildPlaces(subs: string[], pages: ArrayLike<number>,
                            site?: ArrayLike<number>): Places {
  const host = hostIds(subs);
  const by = site ?? host;
  let ns = 0;
  for (let i = 0; i < by.length; i++) if (by[i] >= ns) ns = by[i] + 1;
  const sitePages = new Float64Array(ns);
  for (let i = 0; i < by.length; i++) sitePages[by[i]] += pages[i] || 0;
  return { site: by, host, pages, sitePages,
           names: subs.map((s) => s.replace(/ \[\d+\]$/, "")) };
}

export interface Stop {
  /** index into the route's nodes */
  at: number;
  /** a path inside a host notable enough to stop at on the way through it */
  landmark: boolean;
}

/**
 * A neighbourhood a route passes through inside one site (a path, or another
 * subdomain) is a stop of its own only when it is a real part of that site:
 * at least this share of the site's pages, and this many pages outright. Most
 * of a big site's neighbourhoods are a handful of pages each and fail both.
 */
export const LANDMARK_SHARE = 0.15;
export const LANDMARK_MIN_PAGES = 40;
/** however big the site, a stretch through it stops at no more than this many of its parts */
export const LANDMARKS_PER_HOST = 2;

/**
 * The stops that make a journey, as indices into its nodes.
 *
 * A route is a run of settlements, and long stretches of it can belong to the
 * same site: one path after another, or back and forth between two of its
 * subdomains, which reads as standing still. So each stretch through a site
 * is cut down to where the route enters it, where it leaves, and in between
 * only the parts notable enough to visit for their own sake. Every other stop
 * is a new place.
 */
export function meaningfulStops(nodes: number[], P: Places): Stop[] {
  const out: Stop[] = [];
  const n = nodes.length;
  for (let i = 0; i < n;) {
    const h = P.site[nodes[i]];
    let j = i;
    while (j + 1 < n && P.site[nodes[j + 1]] === h) j++;
    out.push({ at: i, landmark: false });
    if (j - i > 1) {
      const floor = Math.max(LANDMARK_MIN_PAGES, LANDMARK_SHARE * P.sitePages[h]);
      const ends = new Set([P.names[nodes[i]], P.names[nodes[j]]]);
      // one stop per path: a busy path split into chunks is still one place
      const byName = new Map<string, number>();
      for (let m = i + 1; m < j; m++) {
        const nm = P.names[nodes[m]];
        if ((P.pages[nodes[m]] || 0) < floor || ends.has(nm)) continue;
        const prev = byName.get(nm);
        if (prev === undefined || P.pages[nodes[m]] > P.pages[nodes[prev]]) byName.set(nm, m);
      }
      const picks = [...byName.values()]
        .sort((a, b) => (P.pages[nodes[b]] as number) - (P.pages[nodes[a]] as number))
        .slice(0, LANDMARKS_PER_HOST)
        .sort((a, b) => a - b);
      for (const m of picks) out.push({ at: m, landmark: true });
    }
    if (j > i) out.push({ at: j, landmark: false });
    i = j + 1;
  }
  return out;
}
