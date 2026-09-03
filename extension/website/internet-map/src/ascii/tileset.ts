/**
 * Tile-set: settlements are stamped at their own scale, not as single glyphs.
 *
 * A domain is a city, a subdomain is a neighbourhood, a page is one building.
 * Drawing all three as one character each makes a road — also one character
 * wide — look like a motorway ploughed through everything. Stamping a city as a
 * multi-cell block of built ground puts the road back in proportion.
 *
 * Which tier gets stamped depends on the level: an entity is drawn as a tile
 * only while its footprint is a handful of cells. Zoomed out that is domains;
 * zoom in and domains grow past tile size, so neighbourhoods take over; zoom
 * further and pages do. Nothing is ever drawn twice at the same scale.
 */

import { TINT_WOOD, TINT_WOOD_N, TINT_FIELD, TINT_FIELD_N,
         TINT_PASTEL, TINT_FAMILIES, TINT_STEPS, BUILD_ALPHA } from "./glyphs";

/** Deterministic hash so a settlement looks the same every time it is drawn. */
function hash3(a: number, b: number, c: number): number {
  let h = (a * 0x27d4eb2d) ^ (b * 0x165667b1) ^ (c * 0x9e3779b9);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export interface StampTarget {
  cols: number;
  rows: number;
  land: Uint8Array;      // landmark glyph index, 0 = none
  tint: Uint8Array;      // PALETTE index, 0 = the layer's own colour
  /** which page's building is in this cell, -1 for none */
  owner: Int32Array;
  /** that building's traffic, so a busier page wins a contested cell */
  rank: Float32Array;
  /** per-cell opacity step, index into BUILD_ALPHA */
  shade: Uint8Array;
  /** road traversal level, so nothing is built in the carriageway */
  road: Uint8Array;
}

/** Landmark glyph table; index 0 is "nothing". */
export const LANDMARKS = [
  " ",
  // 1-12 buildings, roughly by grandeur
  "j", "G",              // small arch, gate
  "L", "h", "H",         // gateposts, tower, domed hall
  "l", "g", "D",         // twin columns, high tower, columned facade
  "d", "f", "P", "k",    // gatehouse, banded tower, spires, monument
  "i", "u",              // 13-14 countryside
  "i", "~",              // 15-16 open-country woodland
];

/** Buildings by grandeur; several per tier so a street is not one stamp. */
const BUILD_TIERS = [
  [1, 2],
  [3, 4, 5],
  [6, 7, 8],
  [9, 10, 11, 12],
];
export const LM_TREE = 13, LM_GRASS = 14;
/**
 * Open-country woodland. Indexed above the countryside glyphs so the renderer
 * can hold wild ground further back than a town's hedgerows.
 */
export const LM_WTREE = 15, LM_CONIF = 16;

/**
 * One page, one building. Colour comes from the district, not the page, so a
 * quarter reads as a quarter before you touch it.
 */

export function stampBuilding(
  t: StampTarget,
  cx: number, cy: number,
  weight: number,      // 0..1, log traffic
  page: number,        // index, recorded so hit-testing is a grid lookup
  fam: number,         // hue family, chosen so neighbours differ
  host: number,        // subdomain — the lightness step
  fw = 1, fh = 1,      // footprint in cells, from prominence
) {
  if (cx < 0 || cy < 0 || cx >= t.cols || cy >= t.rows) return;
  let i = cy * t.cols + cx;
  // roads are rasterised first; step aside rather than build on one
  if (t.road[i]) {
    let moved = -1;
    for (let r = 1; r <= 2 && moved < 0; r++) {
      for (let dy = -r; dy <= r && moved < 0; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          const y = cy + dy, x = cx + dx;
          if (y < 0 || x < 0 || y >= t.rows || x >= t.cols) continue;
          const k = y * t.cols + x;
          if (!t.road[k] && t.owner[k] < 0) { moved = k; break; }
        }
      }
    }
    if (moved < 0) return;
    i = moved;
  }
  // where two pages land in one cell, the busier one gets the frontage
  if (t.owner[i] >= 0 && t.rank[i] >= weight) return;
  const tier = weight > 0.72 ? 3 : weight > 0.48 ? 2 : weight > 0.26 ? 1 : 0;
  const set = BUILD_TIERS[tier];
  const glyph = set[(hash3(page, 0xb1d, 1) * set.length) | 0];
  // domain -> hue (chosen upstream so neighbours differ), subdomain ->
  // lightness, reach -> opacity
  const step = (hash3(host, 0x51de, 3) * TINT_STEPS) | 0;
  const j = hash3(page, 0x9e37, 2);
  const tint = TINT_PASTEL + (fam % TINT_FAMILIES) * TINT_STEPS + step;
  const shade = Math.min(BUILD_ALPHA.length - 1,
                         (weight * BUILD_ALPHA.length + j * 1.2) | 0);
  // a tall building occupies its whole plot, so it reads as one structure
  const y0 = (i / t.cols) | 0, x0 = i - y0 * t.cols;
  const multi = fw > 1 || fh > 1;
  for (let dy = 0; dy < fh; dy++) {
    for (let dx = 0; dx < fw; dx++) {
      const y = y0 + dy, x = x0 + dx;
      if (y < 0 || x < 0 || y >= t.rows || x >= t.cols) continue;
      const k = y * t.cols + x;
      if (t.road[k]) continue;
      if (t.owner[k] >= 0 && t.rank[k] > weight) continue;
      // a cell of daylight, or two large plots merge into one mass
      if (multi) {
        const n1 = x > 0 ? t.owner[k - 1] : -1;
        const n2 = x < t.cols - 1 ? t.owner[k + 1] : -1;
        const n3 = y > 0 ? t.owner[k - t.cols] : -1;
        const n4 = y < t.rows - 1 ? t.owner[k + t.cols] : -1;
        if ((n1 >= 0 && n1 !== page) || (n2 >= 0 && n2 !== page) ||
            (n3 >= 0 && n3 !== page) || (n4 >= 0 && n4 !== page)) continue;
      }
      t.land[k] = glyph;
      t.tint[k] = tint;
      t.shade[k] = shade;
      t.owner[k] = page;
      t.rank[k] = weight;
    }
  }
}

/** Countryside around a town, thinning with distance so the edge fades. */
export function stampCountryside(t: StampTarget, seed: number) {
  const { cols, rows, land, tint } = t;
  const isBuilt = (k: number) => land[k] > 0 && land[k] < LM_TREE;
  const R = 3;
  for (let y = R; y < rows - R; y++) {
    for (let x = R; x < cols - R; x++) {
      const i = y * cols + x;
      if (land[i]) continue;
      // distance to the nearest built cell, out to R
      let d = -1;
      for (let r = 1; r <= R && d < 0; r++) {
        for (let k = -r; k <= r && d < 0; k++) {
          if (isBuilt(i + k - r * cols) || isBuilt(i + k + r * cols) ||
              isBuilt(i - r + k * cols) || isBuilt(i + r + k * cols)) d = r;
        }
      }
      if (d < 0) continue;
      const n = hash3(seed, x, y);
      const p = 0.20 * (1 - (d - 1) / R);      // thins with distance
      if (n > 1 - p * 0.4) land[i] = LM_TREE;
      else if (n > 1 - p) land[i] = LM_GRASS;
      // hedgerow and pasture: greyer and lighter than the wild forest
      if (land[i]) tint[i] = TINT_FIELD + ((n * 7919) % TINT_FIELD_N | 0);
    }
  }
}


/** Value noise on a lattice, smoothstepped. Deterministic, no allocation. */
function vnoise(x: number, y: number, seed: number): number {
  const xi = Math.floor(x), yi = Math.floor(y);
  const fx = x - xi, fy = y - yi;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const at = (a: number, b: number) => hash3(seed, a, b);
  const n00 = at(xi, yi), n10 = at(xi + 1, yi);
  const n01 = at(xi, yi + 1), n11 = at(xi + 1, yi + 1);
  return (n00 * (1 - sx) + n10 * sx) * (1 - sy) +
         (n01 * (1 - sx) + n11 * sx) * sy;
}

function fbm(x: number, y: number, seed: number): number {
  let v = 0, amp = 0.5, f = 1;
  for (let o = 0; o < 3; o++) {
    v += amp * vnoise(x * f, y * f, seed + o * 101);
    f *= 2.07; amp *= 0.5;
  }
  return v / 0.875;
}

/**
 * Fill the empty country with mountains, downs and woodland.
 *
 * This is scenery, not data — nothing in the browsing log says where a
 * mountain is, and unlike the height field that used to push settlements
 * around, this touches only glyphs in cells that are already empty. It exists
 * because a map with nothing between its cities reads as an unfinished
 * diagram rather than a place.
 *
 * Ranges come from ridged noise (1 - |2n-1|), which produces connected lines
 * rather than blobs, so mountains form chains the way they should. Woodland
 * uses the plain field, so it comes in patches. A second, much slower field
 * gates the whole thing, so some country is wooded and some is genuinely
 * empty instead of everywhere being uniformly dusted.
 */
export function stampWilderness(
  t: StampTarget, roadLvl: Uint8Array, aspect: number, seed: number,
) {
  const { cols, rows, land, tint } = t;

  // Keep well clear of anywhere built. Testing every cell's neighbourhood
  // directly is millions of probes, so mark a coarse grid and dilate that.
  // Two rings, not one: scenery belongs in country that is genuinely empty,
  // not in the gap between a town and its outskirts.
  const B = 4;
  const bw = Math.ceil(cols / B), bh = Math.ceil(rows / B);
  const cdist = new Int16Array(bw * bh).fill(-1);
  let wave: number[] = [];
  for (let y = 0; y < rows; y++) {
    const yb = (y / B) | 0;
    for (let x = 0; x < cols; x++) {
      const lb = land[y * cols + x];
      if (!lb || lb >= LM_TREE) continue;
      const c = yb * bw + ((x / B) | 0);
      if (cdist[c] !== 0) { cdist[c] = 0; wave.push(c); }
    }
  }
  // Distance from inhabited country, on the coarse grid.
  for (let d = 1; wave.length && d <= 64; d++) {
    const next: number[] = [];
    for (const c of wave) {
      const y = (c / bw) | 0, x = c - y * bw;
      for (let k = 0; k < 4; k++) {
        const xx = x + (k === 0 ? 1 : k === 1 ? -1 : 0);
        const yy = y + (k === 2 ? 1 : k === 3 ? -1 : 0);
        if (xx < 0 || yy < 0 || xx >= bw || yy >= bh) continue;
        const j = yy * bw + xx;
        if (cdist[j] >= 0) continue;
        cdist[j] = d;
        next.push(j);
      }
    }
    wave = next;
  }

  /**
   * Scenery lives in a band around the settled country: clear of the towns,
   * and fading out well before the edge of the grid.
   *
   * Filling every empty cell put scenery into the far corners too, so zoomed
   * out the world ended at the canvas boundary and read as a rectangle. The
   * taper is measured from inhabited ground rather than from the grid, so the
   * map fades into nothing along whatever shape the data actually has.
   */
  // Inhabited ground is now scattered buildings rather than solid discs, so
  // far more of the map qualifies as empty — these had to move out with it.
  const NEARC = 3, FAR0 = 6, FAR1 = 13;
  const taperAt = (x: number, y: number) => {
    const d = cdist[((y / B) | 0) * bw + ((x / B) | 0)];
    if (d < NEARC) return 0;
    if (d <= FAR0) return 1;
    if (d >= FAR1) return 0;
    const u = (d - FAR0) / (FAR1 - FAR0);
    return 1 - u * u * (3 - 2 * u);
  };

  const F = 0.028;          // relief scale, in 1/cells
  const G = 0.0045;         // which country has any relief at all
  const REACH = 5;          // how far downhill the woods run

  // ── 1. where a stand takes hold: the crest of the relief field ───────────
  // Nothing is drawn for the crest itself beyond dense woodland; it is only
  // the seed the forest grows out from.
  const peaks: number[] = [];
  for (let y = 0; y < rows; y++) {
    const ya = y * aspect;  // cells are taller than wide; keep features round
    for (let x = 0; x < cols; x++) {
      const i = y * cols + x;
      if (land[i] || roadLvl[i]) continue;
      const taper = taperAt(x, y);
      if (taper <= 0) continue;
      if (fbm(x * G, ya * G, seed + 7) < 0.70) continue;
      const n = fbm(x * F, ya * F, seed);
      const ridge = 1 - Math.abs(2 * n - 1);
      if (ridge < 0.962) continue;
      const jm = hash3(seed + 3, x, y);
      if (jm > taper) continue;                 // thins out toward the margins
      if (ridge < 0.978 && jm < 0.42) continue;
      land[i] = LM_CONIF;
      tint[i] = TINT_WOOD + (hash3(seed + 21, x, y) * 2) | 0;   // deepest green
      peaks.push(i);
    }
  }

  // ── 2. the stand, grown outward from those seeds ─────────────────────────
  //
  // Trees used to come from a separate threshold on the same noise, so they
  // appeared wherever the field happened to be high and the map read as two
  // unrelated stipples laid over each other. Growing them outward instead
  // gives woods an inside and an outside: close conifer at the core, broadleaf
  // further down, thinning with distance so a wood fades into open country
  // rather than ending on a line. Colour follows the same gradient — deepest
  // green in the middle of a stand, palest at its edge.
  const dist = new Int8Array(cols * rows);
  let frontier = peaks;
  for (let d = 1; d <= REACH && frontier.length; d++) {
    const next: number[] = [];
    for (const i of frontier) {
      const y = (i / cols) | 0, x = i - y * cols;
      for (let k = 0; k < 4; k++) {
        const xx = x + (k === 0 ? 1 : k === 1 ? -1 : 0);
        const yy = y + (k === 2 ? 1 : k === 3 ? -1 : 0);
        if (xx < 0 || yy < 0 || xx >= cols || yy >= rows) continue;
        const j = yy * cols + xx;
        if (dist[j] || land[j] || roadLvl[j]) continue;
        dist[j] = d;
        next.push(j);
        // density falls off downhill; conifer close in, broadleaf further out
        const p = 0.30 * (1 - (d - 1) / REACH);
        const jit = hash3(seed + 11, xx, yy);
        if (jit < p) {
          land[j] = d <= 3 ? LM_CONIF : LM_WTREE;
          const shade = Math.min(TINT_WOOD_N - 1,
            ((d - 1) / REACH) * TINT_WOOD_N + hash3(seed + 31, xx, yy) * 1.4) | 0;
          tint[j] = TINT_WOOD + shade;
        }
      }
    }
    frontier = next;
  }

  let placed = 0;
  for (let i = 0; i < land.length; i++) if (land[i] >= LM_WTREE) placed++;
  (globalThis as any).__wildStats = { placed, pct: placed / (cols * rows) };
  return placed;
}
