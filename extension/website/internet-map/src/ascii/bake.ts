/**
 * The map is baked once, in full, and never touched again.
 *
 * One world-anchored character grid holds everything — terrain, landmarks and
 * roads. Link data in, a single constant ASCII artifact out. Zoom and pan are a
 * camera over it and nothing else; there is no pyramid to keep consistent, no
 * per-frame rasterisation, and the glyph at a given place is the same glyph
 * forever.
 */
import { MapData } from "../data";
import { stampBuilding, stampCountryside, stampWilderness, StampTarget } from "./tileset";
import { prominence, footprint, Refs } from "./prominence";
import { roadPath, GRIDDED } from "./roadgeom";

const N = 1, E = 2, S = 4, W = 8;

export interface BakedMap {
  cellW: number;         // world units per cell, x
  cellH: number;         // world units per cell, y (glyphs are taller than wide)
  cols: number;
  rows: number;
  x0: number;
  y0: number;
  land: Uint8Array;      // landmark glyph index, 0 = none
  /** 0 = no road, 1..ROAD_LEVELS = how heavily travelled */
  roadLvl: Uint8Array;
  roadBits: Uint8Array;  // N/E/S/W
  /** PALETTE index per cell, 0 = the layer's own colour */
  tint: Uint8Array;
  /** page index whose building sits in this cell, -1 for none */
  owner: Int32Array;
  /** per-cell opacity step for buildings, index into BUILD_ALPHA */
  shade: Uint8Array;
  stats: { terrainCells: number; roadCells: number; roadsDrawn: number };
}

export interface BakeOpts {
  /** glyphs are taller than wide, so world cells are too */
  aspect: number;
  /** grid width in characters — the resolution of the whole map */
  cols: number;
  rampTop: number;
}

/** Brightness steps for roads. Frequency, not category. */
export const ROAD_LEVELS = 16;


export function bakeMap(data: MapData, o: BakeOpts): BakedMap {
  const { A } = data;
  const [x0, y0, x1, y1] = data.head.extent;
  const wSpan = Math.max(x1 - x0, 1e-6);
  const hSpan = Math.max(y1 - y0, 1e-6);

  const cols = o.cols;
  const cellW = wSpan / cols;
  const cellH = cellW * o.aspect;
  const rows = Math.max(8, Math.ceil(hSpan / cellH) + 1);
  const n = cols * rows;

  const land = new Uint8Array(n);
  const roadLvl = new Uint8Array(n);
  const roadBits = new Uint8Array(n);
  const tint = new Uint8Array(n);
  const owner = new Int32Array(n).fill(-1);
  const rank = new Float32Array(n);
  const shade = new Uint8Array(n);
  const T: StampTarget = { cols, rows, land, tint, owner, rank, shade, road: roadLvl };

  // roads still run between settlements, so their positions are still needed
  const sx = A.sub_x as Float32Array, sy = A.sub_y as Float32Array;
  const sgrid = A.sub_grid as Float32Array | undefined;
  const spages = A.sub_pages as Uint32Array | undefined;

  // ── roads: brightness IS traversal count ──────────────────────────────────
  // Every road is drawn. There is no budget and there are no classes, because
  // frequency already does the sorting: a link two journeys used lands at the
  // bottom of the ramp and is all but invisible, while a route everyone shares
  // burns through. Quantising this into four fixed opacities — which is what it
  // used to do — threw away the one number that makes the picture.
  let roadCells = 0, roadsDrawn = 0;

  const ra = A.road_a as Uint32Array | undefined;
  const rb = A.road_b as Uint32Array | undefined;
  const rw = A.road_w as Float32Array | undefined;

  if (ra && rb && rw) {
    let mx = 0;
    for (let i = 0; i < rw.length; i++) if (rw[i] > mx) mx = rw[i];
    const lg = Math.log1p(mx) || 1;
    for (let i = 0; i < ra.length; i++) {
      const lvl = Math.max(1, Math.min(ROAD_LEVELS,
        Math.round((Math.log1p(rw[i]) / lg) * ROAD_LEVELS)));
      roadCells += line(ra[i], rb[i], lvl);
      roadsDrawn++;
    }
  }

  // ── one building per page ─────────────────────────────────────────────────
  const px = A.page_x as Float32Array, py = A.page_y as Float32Array;
  const hits = A.page_hits as Uint32Array;
  // Brightness is UNIQUE VISITORS, not visit count. One person reloading a
  // page a thousand times is not a bright place; a page a thousand people each
  // opened once is. Visits still decide which building wins a contested cell,
  // because that is about how much frontage a page has earned.
  const people = A.page_parts as Uint16Array | undefined;
  const reach = people ?? hits;
  const psub = A.page_sub as Uint32Array;
  const sdom = A.sub_dom as Uint32Array;
  const shue = A.sub_hue as Uint8Array | undefined;
  const sparts = A.sub_parts as Uint16Array | undefined;
  // "x.com/a [3]" and "[4]" are one site split for size, not two places
  const subs = data.labels.subs;
  const hostOf = new Int32Array(subs.length);
  {
    const seen = new Map<string, number>();
    for (let i = 0; i < subs.length; i++) {
      const k = subs[i].replace(/ \[\d+\]$/, "");
      let v = seen.get(k);
      if (v === undefined) { v = seen.size; seen.set(k, v); }
      hostOf[i] = v;
    }
  }
  // one prominence drives both brightness and plot size — see prominence.ts
  const rsort = Float64Array.from(reach).sort();
  const ref: Refs = {
    reach: rsort[Math.min(rsort.length - 1, Math.floor(rsort.length * 0.9999))] || 1,
    visits: (() => { let m = 1; for (let i = 0; i < hits.length; i++) if (hits[i] > m) m = hits[i]; return m; })(),
  };
  const prom = new Float32Array(reach.length);
  for (let i = 0; i < reach.length; i++) {
    prom[i] = prominence(reach[i], sparts ? sparts[psub[i]] : 0, hits[i], ref);
  }

  // biggest first, so a tower can claim the gap around it
  const order = Array.from({ length: px.length }, (_, i) => i);
  order.sort((a, b) => prom[b] - prom[a]);
  for (const i of order) {
    stampBuilding(T,
      Math.floor((px[i] - x0) / cellW), Math.floor((py[i] - y0) / cellH),
      prom[i], i, shue ? shue[psub[i]] : sdom[psub[i]], hostOf[psub[i]],
      ...footprint(prom[i], i));
  }

  stampCountryside(T, 977);

  let terrainCells = 0;
  for (let i = 0; i < n; i++) if (land[i]) terrainCells++;

  /** A road, from the shared geometry so the overlay can trace the same line. */
  function line(a: number, b: number, lvl: number): number {
    const ax = (sx[a] - x0) / cellW, ay = (sy[a] - y0) / cellH;
    const bx = (sx[b] - x0) / cellW, by = (sy[b] - y0) / cellH;
    const gridded = !!(sgrid && spages && sgrid[a] === sgrid[b] &&
                       spages[a] >= GRIDDED && spages[b] >= GRIDDED);
    const pts = roadPath(ax, ay, bx, by, gridded ? sgrid![a] : null);
    let n = 0;
    for (let i = 2; i < pts.length; i += 2) {
      n += seg(Math.floor(pts[i - 2]), Math.floor(pts[i - 1]),
               Math.floor(pts[i]), Math.floor(pts[i + 1]), lvl);
    }
    return n;
  }

  /** Bresenham across the grid, recording which way the road leaves each cell. */
  function seg(cx: number, cy: number, tx: number, ty: number, lvl: number): number {
    const dx = Math.abs(tx - cx), sxs = cx < tx ? 1 : -1;
    const dy = -Math.abs(ty - cy), sys = cy < ty ? 1 : -1;
    let err = dx + dy, guard = 0, painted = 0;
    for (;;) {
      if (++guard > 40000) return painted;
      const inside = cx >= 0 && cy >= 0 && cx < cols && cy < rows;
      const here = inside ? cy * cols + cx : -1;
      if (here >= 0) {
        // busiest wins where routes overlap
        if (lvl > roadLvl[here]) roadLvl[here] = lvl;
        painted++;
      }
      if (cx === tx && cy === ty) return painted;
      const e2 = 2 * err;
      let stepX = 0, stepY = 0;
      if (e2 >= dy) { err += dy; cx += sxs; stepX = sxs; }
      if (e2 <= dx) { err += dx; cy += sys; stepY = sys; }
      if (here >= 0) {
        if (stepX > 0) roadBits[here] |= E;
        if (stepX < 0) roadBits[here] |= W;
        if (stepY > 0) roadBits[here] |= S;
        if (stepY < 0) roadBits[here] |= N;
      }
      const ni = cx >= 0 && cy >= 0 && cx < cols && cy < rows ? cy * cols + cx : -1;
      if (ni >= 0) {
        if (stepX > 0) roadBits[ni] |= W;
        if (stepX < 0) roadBits[ni] |= E;
        if (stepY > 0) roadBits[ni] |= N;
        if (stepY < 0) roadBits[ni] |= S;
      }
    }
  }

  // Scenery last: it fills what is still empty once towns and roads are down.
  stampWilderness(T, roadLvl, o.aspect, 4211);

  return { cellW, cellH, cols, rows, x0, y0, land, tint, owner, shade, roadLvl, roadBits,
           stats: { terrainCells, roadCells, roadsDrawn } };
}
