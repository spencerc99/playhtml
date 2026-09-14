// ABOUTME: Writes a small synthetic internet-map bundle for local development and tests.
// ABOUTME: Real bundles carry participants' URLs and never ship; this one carries invented ones.

/**
 * The internet map viewer needs a data bundle (map.json + map.bin +
 * labels.json.gz) that is not committed, because the real one is built from
 * real browsing traces. This script invents a plausible one — a dozen cities,
 * their neighbourhoods and buildings, and the roads between them — with the
 * exact array layout `internet-map/src/data.ts` reads, so the viewer, the walk
 * mode and the extension widget can all be exercised without any real data.
 *
 *   bun run extension/website/scripts/internet-map-fixture.ts [outDir]
 *
 * Deterministic: the same seed writes the same bundle every time.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(
  process.argv[2] ?? join(HERE, "..", "public", "internet-map", "data", "fixture"),
);

/** mulberry32: small, seedable, good enough for scenery */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = rng(20260913);
const gauss = () => {
  const u = 1 - rand(), v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
};
const pick = <T,>(xs: readonly T[]) => xs[Math.floor(rand() * xs.length)];

interface DomainSpec {
  name: string;
  /** hostnames under the domain; the first is the domain's own front door */
  hosts: string[];
  /** rough number of pages per host */
  size: number;
  paths: string[];
  titles: string[];
}

/** Invented places. Hostnames are real so the extension widget can be pointed at them in tests. */
const DOMAINS: DomainSpec[] = [
  { name: "github.com", hosts: ["github.com", "gist.github.com"], size: 260,
    paths: ["/spencerc99/playhtml", "/issues", "/pulls", "/explore", "/trending", "/settings"],
    titles: ["playhtml", "Issues", "Pull requests", "Explore", "Trending", "Settings"] },
  { name: "wikipedia.org", hosts: ["en.wikipedia.org", "de.wikipedia.org"], size: 420,
    paths: ["/wiki/Internet", "/wiki/Cartography", "/wiki/Hypertext", "/wiki/Map", "/wiki/Road", "/wiki/Walking"],
    titles: ["Internet", "Cartography", "Hypertext", "Map", "Road", "Walking"] },
  { name: "youtube.com", hosts: ["youtube.com", "music.youtube.com"], size: 520,
    paths: ["/watch", "/feed/subscriptions", "/results", "/playlist", "/shorts"],
    titles: ["a video", "Subscriptions", "Search", "Playlist", "Shorts"] },
  { name: "google.com", hosts: ["docs.google.com", "mail.google.com", "calendar.google.com"], size: 180,
    paths: ["/document/d/1", "/mail/u/0", "/calendar/u/0", "/spreadsheets/d/2", "/presentation/d/3"],
    titles: ["a document", "Inbox", "Calendar", "a spreadsheet", "a deck"] },
  { name: "ycombinator.com", hosts: ["news.ycombinator.com"], size: 140,
    paths: ["/", "/item", "/newest", "/ask", "/show"],
    titles: ["Hacker News", "a thread", "New links", "Ask", "Show"] },
  { name: "playhtml.fun", hosts: ["playhtml.fun"], size: 60,
    paths: ["/", "/docs", "/docs/capabilities", "/experiments", "/about"],
    titles: ["playhtml", "Docs", "Capabilities", "Experiments", "About"] },
  { name: "wewere.online", hosts: ["wewere.online"], size: 45,
    paths: ["/", "/portrait", "/commute", "/changelog", "/archive"],
    titles: ["we were online", "Portrait", "Commute", "Changelog", "Archive"] },
  { name: "are.na", hosts: ["are.na"], size: 95,
    paths: ["/spencer-chang", "/explore", "/block/1", "/channel/roads", "/feed"],
    titles: ["Spencer", "Explore", "a block", "roads", "Feed"] },
  { name: "reddit.com", hosts: ["reddit.com", "old.reddit.com"], size: 300,
    paths: ["/r/webdev", "/r/maps", "/r/ascii", "/r/programming", "/comments/1"],
    titles: ["webdev", "maps", "ascii", "programming", "a thread"] },
  { name: "nytimes.com", hosts: ["nytimes.com", "cooking.nytimes.com"], size: 120,
    paths: ["/", "/section/world", "/section/technology", "/recipes/1", "/crosswords"],
    titles: ["The New York Times", "World", "Technology", "a recipe", "Crosswords"] },
  { name: "arxiv.org", hosts: ["arxiv.org"], size: 80,
    paths: ["/abs/2401.00001", "/list/cs.HC/recent", "/abs/2309.12345", "/search"],
    titles: ["a paper", "Recent HCI", "another paper", "Search"] },
  { name: "substack.com", hosts: ["substack.com", "read.substack.com"], size: 70,
    paths: ["/home", "/inbox", "/p/on-walking", "/p/maps-of-nothing"],
    titles: ["Home", "Inbox", "On walking", "Maps of nothing"] },
  { name: "mdn.io", hosts: ["developer.mozilla.org"], size: 110,
    paths: ["/en-US/docs/Web/API/Canvas", "/en-US/docs/Web/CSS", "/en-US/docs/Web/JavaScript"],
    titles: ["Canvas API", "CSS", "JavaScript"] },
  { name: "bsky.app", hosts: ["bsky.app"], size: 130,
    paths: ["/", "/profile/spencer", "/notifications", "/search"],
    titles: ["Bluesky", "Spencer", "Notifications", "Search"] },
];

/** A neighbourhood is at most this many pages; busier hosts split into chunks. */
const CHUNK = 400;
const GRIDDED = 42;

const EXTENT: [number, number, number, number] = [0, 0, 12000, 8400];

interface Sub { name: string; host: string; dom: number; x: number; y: number; grid: number; pages: number[]; hue: number }

const domX: number[] = [], domY: number[] = [], domR: number[] = [], domVisits: number[] = [];
const domNames: string[] = [];
const subs: Sub[] = [];
const pageX: number[] = [], pageY: number[] = [], pageR: number[] = [];
const pageHits: number[] = [], pageParts: number[] = [], pageSub: number[] = [];
const pageNames: string[] = [], pageTitles: string[] = [];

// Cities on a loose ring, so no two land on each other and the roads between
// them have to cross open country.
DOMAINS.forEach((d, di) => {
  const ang = (di / DOMAINS.length) * Math.PI * 2 + rand() * 0.3;
  const rad = 2600 + rand() * 900;
  const cx = EXTENT[2] / 2 + Math.cos(ang) * rad * 1.15;
  const cy = EXTENT[3] / 2 + Math.sin(ang) * rad * 0.8;
  domNames.push(d.name);
  domX.push(cx); domY.push(cy);
  let visits = 0;
  const hue = di % 12;
  d.hosts.forEach((host, hi) => {
    const hostSize = Math.round(d.size * (hi === 0 ? 1 : 0.35 + rand() * 0.4));
    const chunks = Math.max(1, Math.ceil(hostSize / CHUNK));
    const hx = cx + (hi === 0 ? 0 : gauss() * 190);
    const hy = cy + (hi === 0 ? 0 : gauss() * 130);
    for (let c = 0; c < chunks; c++) {
      const n = c < chunks - 1 ? CHUNK : hostSize - CHUNK * (chunks - 1);
      const sx = hx + (c ? gauss() * 120 : 0), sy = hy + (c ? gauss() * 80 : 0);
      const sub: Sub = {
        name: chunks > 1 ? `${host}/${d.paths[0].slice(1).split("/")[0] || "home"} [${c + 1}]` : host,
        host, dom: di, x: sx, y: sy, grid: rand() * Math.PI / 2, pages: [], hue,
      };
      // in world units; the bake is 4096 cells across a 12000-unit world, so a
      // unit is a third of a cell and a district is a few dozen cells wide
      const spread = 18 + Math.sqrt(n) * 3.2;
      for (let p = 0; p < n; p++) {
        const k = p % d.paths.length;
        const path = p < d.paths.length ? d.paths[k] : `${d.paths[k].replace(/\/$/, "")}/${p}`;
        const title = p < d.titles.length ? d.titles[k] : `${d.titles[k]} ${p}`;
        pageNames.push(`${host}${path}`);
        pageTitles.push(title);
        pageX.push(sx + gauss() * spread);
        pageY.push(sy + gauss() * spread * 0.7);
        // heavy-tailed traffic: the front door dominates
        const hits = Math.round(Math.exp(gauss() * 1.4 + (p === 0 ? 7 : 2.5)));
        pageHits.push(Math.max(1, hits));
        // The label layer gates a name on r*zoom, and the tier logic on the
        // MEDIAN r per tier, so the medians have to sit in fixed ratios: a
        // page around 1.2, a neighbourhood around 14, a city in the hundreds.
        // Front doors get a radius big enough to earn a name when zoomed in.
        pageR.push(p === 0 ? 7 : 0.8 + rand() * 0.8);
        pageParts.push(Math.max(1, Math.round(Math.sqrt(hits) * (0.6 + rand()))));
        pageSub.push(subs.length);
        sub.pages.push(pageNames.length - 1);
        visits += hits;
      }
      subs.push(sub);
    }
  });
  domVisits.push(visits);
  domR.push(260 + Math.sqrt(visits) * 0.8);
});

// Roads: every neighbourhood links to its nearest two, plus a handful of long
// links so the network has cycles and the far cities are reachable at all.
const roadA: number[] = [], roadB: number[] = [], roadW: number[] = [];
const seen = new Set<string>();
const link = (a: number, b: number, w: number) => {
  if (a === b) return;
  const key = a < b ? `${a}-${b}` : `${b}-${a}`;
  if (seen.has(key)) return;
  seen.add(key);
  roadA.push(a); roadB.push(b); roadW.push(w);
};
const subVisits = subs.map((s) => s.pages.reduce((n, p) => n + pageHits[p], 0));
for (let i = 0; i < subs.length; i++) {
  const near = subs.map((s, j) => ({ j, d: Math.hypot(s.x - subs[i].x, s.y - subs[i].y) }))
    .filter((x) => x.j !== i).sort((p, q) => p.d - q.d);
  for (let k = 0; k < 2 && k < near.length; k++) {
    const j = near[k].j;
    const both = Math.min(subVisits[i], subVisits[j]);
    link(i, j, Math.max(1, Math.round(both * (0.02 + rand() * 0.08))));
  }
}
// long links between the busiest neighbourhoods of each city
const doors = DOMAINS.map((_, di) => subs.findIndex((s) => s.dom === di));
for (let di = 0; di < doors.length; di++) {
  link(doors[di], doors[(di + 1) % doors.length], 40 + Math.round(rand() * 400));
  if (rand() < 0.6) link(doors[di], doors[(di + 3) % doors.length], 10 + Math.round(rand() * 120));
}
// a few motorways: youtube, wikipedia and github talk to everyone
for (const hub of ["youtube.com", "en.wikipedia.org", "github.com"]) {
  const h = subs.findIndex((s) => s.host === hub);
  for (let k = 0; k < 4; k++) link(h, pick(doors), 200 + Math.round(rand() * 1200));
}

const subR = subs.map((s) => 12 + Math.min(6, Math.sqrt(s.pages.length) * 0.25));
const subParts = subs.map((s) => s.pages.reduce((n, p) => n + pageParts[p], 0));

// ---- serialise -------------------------------------------------------------
type ArrType = "float32" | "uint32" | "uint16" | "uint8";
const arrays: { name: string; type: ArrType; data: number[] }[] = [
  { name: "page_x", type: "float32", data: pageX },
  { name: "page_y", type: "float32", data: pageY },
  { name: "page_r", type: "float32", data: pageR },
  { name: "page_hits", type: "uint32", data: pageHits },
  { name: "page_parts", type: "uint16", data: pageParts },
  { name: "page_sub", type: "uint32", data: pageSub },
  { name: "sub_x", type: "float32", data: subs.map((s) => s.x) },
  { name: "sub_y", type: "float32", data: subs.map((s) => s.y) },
  { name: "sub_r", type: "float32", data: subR },
  { name: "sub_visits", type: "uint32", data: subVisits },
  { name: "sub_parts", type: "uint16", data: subParts },
  { name: "sub_dom", type: "uint32", data: subs.map((s) => s.dom) },
  { name: "sub_grid", type: "float32", data: subs.map((s) => s.grid) },
  { name: "sub_pages", type: "uint32", data: subs.map((s) => s.pages.length) },
  { name: "sub_hue", type: "uint8", data: subs.map((s) => s.hue) },
  { name: "dom_x", type: "float32", data: domX },
  { name: "dom_y", type: "float32", data: domY },
  { name: "dom_r", type: "float32", data: domR },
  { name: "dom_visits", type: "uint32", data: domVisits },
  { name: "road_a", type: "uint32", data: roadA },
  { name: "road_b", type: "uint32", data: roadB },
  { name: "road_w", type: "float32", data: roadW },
];
const CTOR = { float32: Float32Array, uint32: Uint32Array, uint16: Uint16Array, uint8: Uint8Array };
const chunks: Uint8Array[] = [];
const index: Record<string, { off: number; len: number; type: ArrType }> = {};
let off = 0;
for (const a of arrays) {
  const view = new CTOR[a.type](a.data);
  const bytes = new Uint8Array(view.buffer);
  index[a.name] = { off, len: a.data.length, type: a.type };
  chunks.push(bytes);
  off += bytes.byteLength;
  const pad = (4 - (off % 4)) % 4;       // keep every view 4-byte aligned
  if (pad) { chunks.push(new Uint8Array(pad)); off += pad; }
}
const bin = new Uint8Array(off);
let at = 0;
for (const c of chunks) { bin.set(c, at); at += c.byteLength; }

const head = {
  counts: {
    pages: pageX.length, subs: subs.length, doms: domNames.length,
    page_edges: 0, sub_edges: roadA.length, dom_edges: 0, roads: roadA.length,
  },
  totals: { visits: pageHits.reduce((a, b) => a + b, 0), participants: 0 },
  extent: EXTENT,
  arrays: index,
  categories: [],
  fixture: true,
};
const labels = {
  pages: pageNames,
  titles: pageTitles,
  subs: subs.map((s) => s.name),
  doms: domNames,
  favicons: {},
};

mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, "map.json"), JSON.stringify(head));
writeFileSync(join(OUT, "map.bin"), bin);
writeFileSync(join(OUT, "labels.json.gz"), gzipSync(JSON.stringify(labels)));
console.log(
  `wrote fixture to ${OUT}: ${pageX.length} pages, ${subs.length} neighbourhoods, ` +
  `${domNames.length} cities, ${roadA.length} roads`,
);
