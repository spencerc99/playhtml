// ABOUTME: Entry point for the internet map viewer; boots data, bake, render, chrome.
// ABOUTME: Vendored from jackyzha0/internet-map; theme and dev panel are our additions.
import "./style.css";
import "./devpanel.css";
import { loadMap, MapData } from "./data";
import { Camera, attachControls } from "./camera";
import { AsciiRenderer } from "./ascii/renderer";
import { bakeMap, ROAD_LEVELS } from "./ascii/bake";
import { LANDMARKS, LM_TREE, LM_WTREE } from "./ascii/tileset";
import { buildRoadGraph, findRoute, stopsAlong, MODES, Mode, Route } from "./route";
import { roadPath, pathCells, GRIDDED } from "./ascii/roadgeom";
import { setRoadGlyphs, ROAD, PALETTE, BUILD_ALPHA, setPalette } from "./ascii/glyphs";
import { LabelLayer } from "./ascii/labels";
import { buildChrome, fmt } from "./ui/chrome";
import { MapSearch, SearchPlace } from "./ui/search";
import { Theme, applyChrome, paletteOf } from "./theme";
import { DevPanel, initialTheme } from "./devpanel";
import { computeAnchors } from "./ascii/anchors";

const $ = <T extends HTMLElement = HTMLElement>(s: string) => document.querySelector(s) as T;

buildChrome($("#ui"));

const q = new URLSearchParams(location.search);
// Which map to load. Bundles carry real browsing URLs and are not committed,
// so they live under the site's public dir and are supplied out of band.
// VITE_DATA picks one at build time; ?data= still overrides at runtime.
const DEFAULT_DATA = (import.meta.env.VITE_DATA as string) || "data-small";
const DATA = "/internet-map/data/" +
  (q.get("data") || DEFAULT_DATA).replace(/[^A-Za-z0-9._-]/g, "");

// The theme owns the building palette and alpha ramp, and the bake reads the
// ramp's LENGTH to pick a shade per cell — so it has to be installed before
// anything is baked. Colour VALUES stay editable afterwards without a rebake.
const boot0 = initialTheme();
let theme: Theme = boot0.theme;
setPalette(paletteOf(theme), theme.buildAlpha);
applyChrome(theme);

const qnum = (k: string, d: number) => {
  const v = parseFloat(q.get(k) ?? "");
  return Number.isFinite(v) ? v : d;
};
/** map resolution in characters across — the whole map is baked at this size */
// 4x the ground. Feature sizes are floored in CELLS, not world units, so
// doubling the grid across leaves a building the same size on screen while
// putting twice the distance between things — which is the room the map needs
// to stop reading as a few crowded blobs.
const MAP_COLS = Math.round(qnum("cols", 4096));
setRoadGlyphs(q.get("roadh"), q.get("roadv"));

const boot = (m: string, p: number) => {
  $("#bootmsg").textContent = m;
  ($("#bootbar") as HTMLElement).style.width = p * 100 + "%";
};

// The grid geometry depends on real font metrics, so the faces must be resident
// before the first measure — otherwise every cell is sized for the fallback.
await Promise.all([
  (document as any).fonts.load('15px "MEKText"'),
  (document as any).fonts.load('15px "MEKDings"'),
]).catch(() => {});

const data: MapData = await loadMap(DATA, boot);
const { A, labels, head } = data;

const canvas = $("#map") as HTMLCanvasElement;
const ctx = canvas.getContext("2d", { alpha: false })!;
const cam = new Camera((head.focus ?? head.extent) as [number, number, number, number]);
// Glyph aspect: both faces advance 0.8em, and a comfortable line box is about
// 1.12em, so world cells are ~1.4x taller than wide.
const CELL_ASPECT = 1.12 / 0.8;
boot("baking map", 0.9);
const baked = bakeMap(data, {
  aspect: CELL_ASPECT,
  cols: MAP_COLS,
  rampTop: 7,
});
const ren = new AsciiRenderer(ctx, baked, theme);

/**
 * Label anchors on each group's densest cluster rather than its centroid, so
 * a name over a split domain sits on one of its lobes instead of the empty
 * ground between them. One pass, at load.
 */
// ?anchors=0 falls back to the bundle's centroids, to compare the two.
const anchors = q.get("anchors") === "0"
  ? { subX: A.sub_x as Float32Array, subY: A.sub_y as Float32Array,
      domX: A.dom_x as Float32Array, domY: A.dom_y as Float32Array }
  : computeAnchors({
      pageX: A.page_x as Float32Array,
      pageY: A.page_y as Float32Array,
      pageWeight: (A.page_parts ?? A.page_hits) as ArrayLike<number>,
      pageSub: A.page_sub as Uint32Array,
      subDom: A.sub_dom as Uint32Array,
      subX: A.sub_x as Float32Array,
      subY: A.sub_y as Float32Array,
      domX: A.dom_x as Float32Array,
      domY: A.dom_y as Float32Array,
      extent: head.extent,
    });

// ------------------------------------------------------------------ state
// The old CFG panel is gone. Place names are off by default; still
// reachable with ?labels=1 or the L key.
let showRoads = q.get("roads") !== "0";
let showLabels = q.get("labels") === "1";
const labelLayer = new LabelLayer();
/** the page whose building is under the cursor */
let hoverPage = -1;
/**
 * District of each page relative to the hover: 3 = this building, 2 = same
 * subdomain, 1 = same domain. Walking visible cells against this lights a
 * building's whole footprint for one pass, not fifteen probes per page.
 */
let districtMask: Uint8Array | null = null;
let maskFor = -1;
/**
 * Where a search just put you. The place's own name may lose its slot to a
 * busier neighbour in the label layer's collision pass, so arriving draws its
 * own mark — a ring around the district and the name over it, fading out once
 * you have seen it.
 */
let landing: { x: number; y: number; r: number; name: string; t0: number } | null = null;

// ------------------------------------------------------------------ routing
const roads = buildRoadGraph(A);
let fromPage = -1, toPage = -1;
let mode: Mode = "fast";
let routes: Route[] = [];

/**
 * Districts, indexed once at load.
 *
 * A neighbourhood belongs to a domain (sub_dom) and, more narrowly, to one
 * hostname — a big subdomain is split into several neighbourhoods that all
 * share a label once its chunk marker is stripped. Hovering lifts both, so the
 * whole of a domain shows faintly and the exact host shows bright.
 */
const SUB_DOM = A.sub_dom as Uint32Array;
const PAGE_SUB = A.page_sub as Uint32Array;
/** the hostname each neighbourhood belongs to, as an id */
const subHost: Int32Array = (() => {
  const ids = new Int32Array(labels.subs.length);
  const seen = new Map<string, number>();
  for (let i = 0; i < labels.subs.length; i++) {
    const h = labels.subs[i].split("/")[0];
    let v = seen.get(h);
    if (v === undefined) { v = seen.size; seen.set(h, v); }
    ids[i] = v;
  }
  return ids;
})();

/** pages of each neighbourhood, so a district can be repainted without a scan */
const subPages: Int32Array[] = (() => {
  const ns = (A.sub_x as Float32Array).length;
  const count = new Int32Array(ns);
  for (let i = 0; i < PAGE_SUB.length; i++) count[PAGE_SUB[i]]++;
  const out: Int32Array[] = new Array(ns);
  for (let d = 0; d < ns; d++) out[d] = new Int32Array(count[d]);
  const at = new Int32Array(ns);
  for (let i = 0; i < PAGE_SUB.length; i++) {
    const d = PAGE_SUB[i];
    out[d][at[d]++] = i;
  }
  return out;
})();
const domMembers: Int32Array[] = (() => {
  const nd = (head.counts as any).doms as number;
  const count = new Int32Array(nd);
  for (let i = 0; i < SUB_DOM.length; i++) count[SUB_DOM[i]]++;
  const out: Int32Array[] = new Array(nd);
  for (let d = 0; d < nd; d++) out[d] = new Int32Array(count[d]);
  const at = new Int32Array(nd);
  for (let i = 0; i < SUB_DOM.length; i++) {
    const d = SUB_DOM[i];
    out[d][at[d]++] = i;
  }
  return out;
})();


const medOf = (a: Float32Array) => {
  const s = Float32Array.from(a).sort();
  return s[s.length >> 1] || 1;
};
const MR_PAGE = medOf(A.page_r as Float32Array);
const MR_SUB = medOf(A.sub_r as Float32Array);
const sstep = (a: number, b: number, x: number) => Math.max(0, Math.min(1, (x - a) / (b - a)));
/** where each tier's names fade in, in screen px of that tier's median radius */
const LOD_PAGE: [number, number] = [0.4, 2.4];
const LOD_SUB: [number, number] = [0.6, 2.8];
const lod = () => ({
  tPage: sstep(LOD_PAGE[0], LOD_PAGE[1], MR_PAGE * cam.k),
  tSub: sstep(LOD_SUB[0], LOD_SUB[1], MR_SUB * cam.k),
});
/** how far a tier must have faded in before it takes the labels over */
const TIER_PAGE = 0.5;
const TIER_SUB = 0.4;
/** the zoom at which a tier's step function reaches `t`, inverting sstep */
const kAt = ([a, b]: [number, number], medianR: number, t: number) =>
  (a + t * (b - a)) / medianR;

// ------------------------------------------------------------------ render
function resize() {
  const dpr = Math.min(devicePixelRatio || 1, 2);
  const w = innerWidth, h = innerHeight;
  canvas.width = w * dpr; canvas.height = h * dpr;
  canvas.style.width = w + "px"; canvas.style.height = h + "px";
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  cam.setViewport(w, h, dpr);
  if (cam.kFit === 1 && cam.k === 1) cam.fit();
  draw();
}

let urlTimer: number | undefined;
function syncURL() {
  clearTimeout(urlTimer);
  urlTimer = window.setTimeout(() => {
    const u = new URL(location.href);
    u.searchParams.set("at", cam.toURLValue());
    history.replaceState(null, "", u);
  }, 400);
}

// pointermove fires faster than the display refreshes, so a synchronous draw
// per event means several full repaints a frame. Coalesce to one.
let pending = false;
let interacting = false;
function draw() {
  if (pending) return;
  pending = true;
  requestAnimationFrame(() => { pending = false; paint(); });
}

function paint() {
  // while dragging, blit the cached map — text is re-laid on release
  ren.draw(cam, { showRoads }, interacting);
  // Not while dragging: the candidate sort and the collision test are per
  // frame, and this is the same reason the map itself blits from cache here.
  if (showLabels && !interacting) {
    // whichever tier is big enough to carry a name at this zoom
    const { tPage, tSub } = lod();
    const src = tPage > TIER_PAGE
      ? { x: A.page_x as Float32Array, y: A.page_y as Float32Array,
          r: A.page_r as Float32Array,
          visits: (A.page_parts ?? A.page_hits) as Uint32Array,
          name: (i: number) => labels.titles[i] || labels.pages[i] }
      : tSub > TIER_SUB
      ? { x: anchors.subX, y: anchors.subY,
          r: A.sub_r as Float32Array,
          visits: (A.sub_parts ?? A.sub_visits) as Uint32Array,
          name: (i: number) => labels.subs[i] }
      : { x: anchors.domX, y: anchors.domY,
          r: A.dom_r as Float32Array, visits: A.dom_visits as Uint32Array,
          name: (i: number) => labels.doms[i] };
    labelLayer.draw(ctx, cam, src, ren.theme.label, ren.theme.labelHalo,
                    ren.cellPx, ren.theme.labelScale);
  }

  if (routes.length) drawRoute();
  if (hoverPage >= 0) drawDistrict();
  if (landing) drawLanding();
  $("#level").textContent = `${baked.cols}\u00d7${baked.rows} · ${ren.cellPx.toFixed(1)}px`
    + (ren.usedCache ? " · cached" : "");
  syncURL();
}

/**
 * Mark the hovered building's district in place.
 *
 * The first version washed the whole map back behind a translucent veil and
 * redrew the district on top. That reads as the map switching modes rather
 * than as one district standing out, and because it redrew at a floor of nine
 * pixels the marked buildings also grew — a district appeared to zoom. Now
 * buildings simply sit at a slightly lower alpha all the time, and hovering
 * repaints the district's own buildings in a highlight colour at exactly the
 * size they already were. Nothing else on the map changes.
 */
/**
 * Highlight colours. The cell is already painted, so repainting at the same
 * alpha would composite twice; these are the composited colour scaled and
 * repainted opaque, which makes "+10%" mean ten percent of what you can see.
 */
/**
 * The lift is a multiplier on the composited colour. On the dark theme that is
 * >1 and the district gets brighter; on paper it is <1 and the district gets
 * darker, which is what "stands out" means against a light ground. Either way
 * the arithmetic is the same and the theme supplies the direction.
 */
let HL_DOM_TBL: string[] = [];
let HL_SUB_TBL: string[] = [];

function buildHighlightTables() {
  const hex = (c: string) => {
    const n = parseInt(c.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  };
  const bg = hex(ren.theme.bg);
  const mk = (k: number) => {
    const out: string[] = [];
    for (let t = 0; t < PALETTE.length; t++) {
      const c = hex(PALETTE[t] || ren.theme.landmark);
      for (let sh = 0; sh < BUILD_ALPHA.length; sh++) {
        const a = ren.theme.buildingGain * BUILD_ALPHA[sh];
        const ch = (i: number) =>
          Math.round(Math.max(0, Math.min(255, (a * c[i] + (1 - a) * bg[i]) * k)));
        out[t * BUILD_ALPHA.length + sh] = `rgb(${ch(0)},${ch(1)},${ch(2)})`;
      }
    }
    return out;
  };
  HL_DOM_TBL = mk(ren.theme.hoverDomLift);
  HL_SUB_TBL = mk(ren.theme.hoverSubLift);
}
buildHighlightTables();

function buildMask() {
  if (maskFor === hoverPage) return;
  maskFor = hoverPage;
  const n = (A.page_x as Float32Array).length;
  if (!districtMask) districtMask = new Uint8Array(n);
  districtMask.fill(0);
  if (hoverPage < 0) return;
  const sub = PAGE_SUB[hoverPage];
  const host = subHost[sub];
  for (const nb of domMembers[SUB_DOM[sub]] ?? []) {
    const same = subHost[nb] === host;
    for (const p of subPages[nb] ?? EMPTY) districtMask[p] = same ? 2 : 1;
  }
  districtMask[hoverPage] = 3;
}

function drawDistrict() {
  buildMask();
  const mask = districtMask;
  if (!mask) return;
  const M = baked;
  const cw = M.cellW * cam.k;
  const c0 = Math.max(0, Math.floor((cam.toWorldX(0) - M.x0) / M.cellW));
  const c1 = Math.min(M.cols - 1, Math.ceil((cam.toWorldX(cam.W) - M.x0) / M.cellW));
  const r0 = Math.max(0, Math.floor((cam.toWorldY(0) - M.y0) / M.cellH));
  const r1 = Math.min(M.rows - 1, Math.ceil((cam.toWorldY(cam.H) - M.y0) / M.cellH));
  if (c1 < c0 || r1 < r0) return;

  ctx.save();
  ctx.textBaseline = "top";
  ctx.globalAlpha = 1;
  ctx.font = `${cw / 0.8}px MEKDings, monospace`;
  const NA = BUILD_ALPHA.length;
  for (let r = r0; r <= r1; r++) {
    const base = r * M.cols;
    const sy = cam.toScreenY(M.y0 + r * M.cellH);
    for (let c = c0; c <= c1; c++) {
      const k = base + c;
      const g = M.land[k];
      if (!g || g >= LM_TREE) continue;
      const o = M.owner[k];
      if (o < 0) continue;
      const lvl = mask[o];
      if (!lvl) continue;
      ctx.fillStyle = lvl === 3 ? ren.theme.hoverSelf
                    : lvl === 2 ? HL_SUB_TBL[M.tint[k] * NA + M.shade[k]]
                                : HL_DOM_TBL[M.tint[k] * NA + M.shade[k]];
      ctx.fillText(LANDMARKS[g], cam.toScreenX(M.x0 + c * M.cellW), sy);
    }
  }
  ctx.restore();
}
const EMPTY: number[] = [];

/** How long the landing mark stays up, and how much of that it spends fading. */
const LANDING_HOLD = 1400;
const LANDING_FADE = 1200;

function drawLanding() {
  const L = landing!;
  const age = performance.now() - L.t0;
  if (age > LANDING_HOLD + LANDING_FADE) { landing = null; return; }
  const a = age < LANDING_HOLD ? 1 : 1 - (age - LANDING_HOLD) / LANDING_FADE;
  const sx = cam.toScreenX(L.x), sy = cam.toScreenY(L.y);
  // the ring settles onto the district rather than snapping to it
  const grow = Math.min(1, age / 320);
  // A place whose pages sprawl wider than the framing can hold would put its
  // ring off every edge, which marks nothing; keep it inside the viewport.
  const spread = Math.min(L.r * cam.k, Math.min(cam.W, cam.H) * 0.34);
  const rad = Math.max(18, spread) * (2.2 - 1.2 * (grow * (2 - grow)));

  ctx.save();
  ctx.globalAlpha = a;
  ctx.lineWidth = 2;
  ctx.strokeStyle = ren.theme.label;
  ctx.beginPath();
  ctx.arc(sx, sy, rad, 0, Math.PI * 2);
  ctx.stroke();

  const px = 17 * ren.theme.labelScale;
  ctx.font = `${px}px MEKText, monospace`;
  ctx.textBaseline = "bottom";
  const w = ctx.measureText(L.name).width;
  // above the ring, unless that is off the top, in which case below it
  const above = sy - rad - 7;
  const ty = above - px >= 8 ? above : Math.min(sy + rad + px + 7, cam.H - 8);
  ctx.lineWidth = Math.max(3, px * 0.3);
  ctx.strokeStyle = ren.theme.labelHalo;
  ctx.lineJoin = "round";
  ctx.strokeText(L.name, sx - w / 2, ty);
  ctx.fillStyle = ren.theme.label;
  ctx.fillText(L.name, sx - w / 2, ty);
  ctx.restore();
  draw();
}

/** Trace the route over the same polyline roadgeom gave the bake. */
function drawRoute() {
  const r = routes.find((x) => x.mode === mode);
  if (!r || !r.ok) return;
  const M = baked;
  const sxA = A.sub_x as Float32Array, syA = A.sub_y as Float32Array;
  const sgrid = A.sub_grid as Float32Array | undefined;
  const spages = A.sub_pages as Uint32Array | undefined;
  const ra = A.road_a as Uint32Array, rb = A.road_b as Uint32Array;

  // paint the road's own cells: a stroked vector reads as laid over the map
  const cw = M.cellW * cam.k, ch = M.cellH * cam.k;
  ctx.save();
  ctx.textBaseline = "top";
  ctx.font = `${cw / 0.8}px MEKDings, monospace`;
  ctx.fillStyle = ren.theme.routeInk;
  const glyph = ROAD.h;
  for (const e of r.edges) {
    const a = ra[e], b = rb[e];
    const ax = (sxA[a] - M.x0) / M.cellW, ay = (syA[a] - M.y0) / M.cellH;
    const bx = (sxA[b] - M.x0) / M.cellW, by = (syA[b] - M.y0) / M.cellH;
    const gridded = !!(sgrid && spages && sgrid[a] === sgrid[b] &&
                       spages[a] >= GRIDDED && spages[b] >= GRIDDED);
    const cells = pathCells(roadPath(ax, ay, bx, by, gridded ? sgrid![a] : null));
    for (let i = 0; i < cells.length; i += 2) {
      const sx2 = cam.toScreenX(M.x0 + cells[i] * M.cellW);
      const sy2 = cam.toScreenY(M.y0 + cells[i + 1] * M.cellH);
      if (sx2 < -cw || sy2 < -ch || sx2 > cam.W || sy2 > cam.H) continue;
      // at a distance a glyph is sub-pixel, so fall back to a solid cell
      if (cw < 3) ctx.fillRect(sx2, sy2, Math.max(1.4, cw), Math.max(1.4, ch));
      else ctx.fillText(glyph, sx2, sy2);
    }
  }

  // routes run between settlements but you start at a building: the legs on
  // foot, dashed so they read as different travel
  const walk = (page: number, node: number) => {
    if (page < 0 || node < 0) return;
    const ax = ((A.page_x as Float32Array)[page] - M.x0) / M.cellW;
    const ay = ((A.page_y as Float32Array)[page] - M.y0) / M.cellH;
    const bx = (sxA[node] - M.x0) / M.cellW;
    const by = (syA[node] - M.y0) / M.cellH;
    const cells = pathCells([ax, ay, bx, by]);
    ctx.fillStyle = ren.theme.routeWalk;
    for (let i = 0; i < cells.length; i += 2) {
      if ((i >> 1) % 2) continue;                    // dashed: every other cell
      const s2x = cam.toScreenX(M.x0 + cells[i] * M.cellW);
      const s2y = cam.toScreenY(M.y0 + cells[i + 1] * M.cellH);
      if (s2x < -cw || s2y < -ch || s2x > cam.W || s2y > cam.H) continue;
      if (cw < 3) ctx.fillRect(s2x, s2y, Math.max(1.4, cw), Math.max(1.4, ch));
      else ctx.fillText(WALK_GLYPH, s2x, s2y);
    }
  };
  walk(fromPage, r.nodes[0]);
  walk(toPage, r.nodes[r.nodes.length - 1]);

  // recolour the plot itself; owner names every cell of it
  const paintEnd = (page: number, fill: string) => {
    if (page < 0) return;
    const c0 = Math.floor(((A.page_x as Float32Array)[page] - M.x0) / M.cellW);
    const r0 = Math.floor(((A.page_y as Float32Array)[page] - M.y0) / M.cellH);
    ctx.fillStyle = fill;
    for (let dy = -8; dy <= 8; dy++) {
      for (let dx = -8; dx <= 8; dx++) {
        const y = r0 + dy, x = c0 + dx;
        if (y < 0 || x < 0 || y >= M.rows || x >= M.cols) continue;
        const k = y * M.cols + x;
        if (M.owner[k] !== page || !M.land[k]) continue;
        const s2x = cam.toScreenX(M.x0 + x * M.cellW);
        const s2y = cam.toScreenY(M.y0 + y * M.cellH);
        if (cw < 3) ctx.fillRect(s2x, s2y, Math.max(1.6, cw), Math.max(1.6, ch));
        else ctx.fillText(LANDMARKS[M.land[k]], s2x, s2y);
      }
    }
  };
  paintEnd(fromPage, ren.theme.routeFrom);
  paintEnd(toPage, ren.theme.routeTo);
  ctx.restore();
}

const WALK_GLYPH = "\u00b7";

/** The itinerary. All modes are solved so the trade-off is visible. */
function renderRoutes() {
  const hint = $("#r-hint"), list = $("#r-list"), legs = $("#r-legs");
  if (!routes.length) {
    hint.textContent = fromPage >= 0
      ? "now click where you want to get to"
      : "click a building, then another";
    hint.style.display = "block";
    list.classList.remove("on");
    legs.textContent = "";
    return;
  }
  hint.style.display = routes.length > 1 ? "none" : "block";
  if (routes.length === 1) hint.textContent = "only one way from here";
  list.classList.add("on");
  list.innerHTML = "";
  const shortest = Math.min(...routes.map((r) => r.length));
  for (const r of routes) {
    const m = MODES.find((x) => x.id === r.mode)!;
    const b = document.createElement("button");
    b.className = "rmode" + (r.mode === mode ? " on" : "");
    const over = r.length / shortest;
    b.innerHTML = `<div class="hd"><b></b><i></i></div><span></span>`;
    b.querySelector("b")!.textContent = m.name;
    b.querySelector("span")!.textContent = m.blurb;
    b.querySelector("i")!.textContent =
      over < 1.005 ? `${r.nodes.length} stops`
                   : `${r.nodes.length} stops \u00b7 +${Math.round((over - 1) * 100)}%`;
    b.onclick = () => { mode = r.mode; renderRoutes(); draw(); };
    list.appendChild(b);
  }
  // where it actually takes you
  const r = routes.find((x) => x.mode === mode);
  legs.innerHTML = "";
  if (r) {
    const stops = stopsAlong(roads, r, A.sub_x as Float32Array, A.sub_y as Float32Array,
                             A.sub_pages as Uint32Array);
    const names: string[] = [];
    for (const s of stops) {
      const nm = labels.subs[s].replace(/ \[\d+\]$/, "");
      if (nm !== names[names.length - 1]) names.push(nm);
    }
    const head = document.createElement("div");
    head.className = "lhead";
    head.textContent = `${names.length} stops \u00b7 ${r.nodes.length} places passed`;
    legs.appendChild(head);
    names.forEach((nm, k) => {
      const d = document.createElement("div");
      d.className = "leg";
      const mark = k === 0 ? "\u25b6" : k === names.length - 1 ? "\u25c9" : "\u00b7";
      d.textContent = `${mark} ${nm}`;
      if (k === 0 || k === names.length - 1) d.classList.add("end");
      legs.appendChild(d);
    });
  }
}
renderRoutes();

// ------------------------------------------------------------------ picking
/**
 * Which building is under the cursor — one array index, because the grid
 * records the owner of every cell. Answers "is the cursor ON a building"
 * rather than "what is nearest", so empty ground shows nothing.
 */
function buildingAt(sx: number, sy: number): number {
  const M = baked;
  const c = Math.floor((cam.toWorldX(sx) - M.x0) / M.cellW);
  const r = Math.floor((cam.toWorldY(sy) - M.y0) / M.cellH);
  if (c < 0 || r < 0 || c >= M.cols || r >= M.rows) return -1;
  // a one-cell target is unhittable at speed, so accept the ring around it
  const rad = ren.cellPx >= 9 ? 0 : 1;
  let best = -1;
  for (let dy = -rad; dy <= rad; dy++) {
    for (let dx = -rad; dx <= rad; dx++) {
      const y = r + dy, x = c + dx;
      if (y < 0 || x < 0 || y >= M.rows || x >= M.cols) continue;
      const o = M.owner[y * M.cols + x];
      if (o >= 0 && (best < 0 || (dx === 0 && dy === 0))) best = o;
    }
  }
  return best;
}

const tip = $("#tip");
tip.innerHTML =
  `<div class="row"><i>domain</i><b id="t-dom"></b></div>` +
  `<div class="row"><i>subdomain</i><b id="t-sub"></b></div>` +
  `<div class="row"><i>path</i><b id="t-path"></b></div>` +
  `<div class="row"><i>traffic</i><b id="t-n"></b></div>`;
const tDom = tip.querySelector("#t-dom")!;
const tSub = tip.querySelector("#t-sub")!;
const tPath = tip.querySelector("#t-path")!;
const tN = tip.querySelector("#t-n")!;
const clip = (s: string, n = 44) => (s.length > n ? s.slice(0, n - 1) + "\u2026" : s);

function hover(sx: number, sy: number) {
  const i = buildingAt(sx, sy);
  if (i !== hoverPage) { hoverPage = i; draw(); }
  if (i < 0) { tip.style.display = "none"; return; }
  showTip(i, sx, sy);
}

function showTip(i: number, sx: number, sy: number) {
  const url = labels.pages[i];
  const cut = url.indexOf("/");
  const host = cut < 0 ? url : url.slice(0, cut);
  const path = cut < 0 ? "/" : url.slice(cut);
  tDom.textContent = labels.doms[SUB_DOM[PAGE_SUB[i]]];
  tSub.textContent = host;
  tPath.textContent = clip(path);
  const ppl = (A.page_parts as Uint16Array)?.[i];
  tN.textContent = `${fmt((A.page_hits as Uint32Array)[i])} visits`
    + (ppl ? ` \u00b7 ${ppl} ${ppl === 1 ? "person" : "people"}` : "");
  tip.style.display = "block";
  const r = tip.getBoundingClientRect();
  tip.style.left = Math.min(sx + 14, cam.W - r.width - 8) + "px";
  tip.style.top = Math.min(sy + 16, cam.H - r.height - 8) + "px";
}

// ------------------------------------------------------------------ controls
attachControls(canvas, cam,
  () => { syncURL(); draw(); },
  (x, y) => hover(x, y),
  (x, y) => pick(x, y),
  (active) => { interacting = active; });

/** Click: origin, destination, then start over. Empty ground clears. */
function pick(x: number, y: number) {
  const i = buildingAt(x, y);
  if (i < 0) { fromPage = toPage = -1; routes = []; renderRoutes(); draw(); return; }
  if (fromPage < 0 || toPage >= 0) { fromPage = i; toPage = -1; routes = []; }
  else { toPage = i; solve(); }
  renderRoutes();
  draw();
}

function solve() {
  if (fromPage < 0 || toPage < 0) { routes = []; return; }
  const a = PAGE_SUB[fromPage], b = PAGE_SUB[toPage];
  const all = MODES.map((m) => findRoute(roads, a, b, m.id)).filter((r) => r.ok);
  // The network is nearly a tree — 2.12 roads per settlement, 3,101 cycles
  // over 50,260 places — so most pairs have exactly one route. Listing four
  // identical options would misrepresent that.
  const seen = new Map<string, Route>();
  for (const r of all) {
    const k = r.edges.join(",");
    if (!seen.has(k)) seen.set(k, r);
  }
  routes = [...seen.values()];
  if (!routes.some((r) => r.mode === mode)) mode = routes[0]?.mode ?? "fast";
}
canvas.addEventListener("pointerleave", () => {
  tip.style.display = "none";
  if (hoverPage >= 0) { hoverPage = -1; draw(); }
});

$("#zin").onclick = () => { cam.zoomAt(cam.W / 2, cam.H / 2, 1.6); draw(); };
$("#zout").onclick = () => { cam.zoomAt(cam.W / 2, cam.H / 2, 1 / 1.6); draw(); };
addEventListener("resize", resize);
addEventListener("keydown", (e) => {
  if (e.key === "Escape") { hoverPage = -1; tip.style.display = "none"; draw(); }
  if (e.key === "l" || e.key === "L") { showLabels = !showLabels; draw(); }
  if (e.key === "r" || e.key === "R") { showRoads = !showRoads; draw(); }
});


/**
 * Swap the whole theme without rebaking.
 *
 * The bake stores a palette SLOT per cell, not a colour, and the slot layout
 * is fixed — so new colour values are picked up on the next paint. What does
 * have to go is the renderer's offscreen cache (a picture in the old colours)
 * and the two hover tables (colours composited against the old background).
 */
function applyTheme(t: Theme) {
  theme = t;
  setPalette(paletteOf(t), t.buildAlpha);
  applyChrome(t);
  ren.setTheme(t);
  buildHighlightTables();
  draw();
}

resize();
cam.fit();
cam.applyURL(q);
draw();
$("#boot").remove();

// ------------------------------------------------------------------ search
/**
 * The searchable places: every domain, then every hostname.
 *
 * A busy hostname is split across several neighbourhoods that all carry the
 * same name once the chunk marker is stripped, so searching the raw
 * subdomain list returns "docs.google.com" a dozen times over. They are one
 * place to anyone typing a name, so they are merged here — into the chunk
 * that holds the most traffic, which is where the district's name is drawn.
 */
const PAGE_HITS = A.page_hits as Uint32Array;
const SUB_VISITS = (A.sub_parts ?? A.sub_visits) as ArrayLike<number>;
/** which subdomain rows each place covers, parallel to `places` */
const placeSubs: Int32Array[] = [];
const places: SearchPlace[] = [];

for (let d = 0; d < labels.doms.length; d++) {
  places.push({
    name: labels.doms[d], kind: "domain", id: places.length,
    x: anchors.domX[d], y: anchors.domY[d], r: (A.dom_r as Float32Array)[d],
    visits: (A.dom_visits as Uint32Array)[d],
  });
  placeSubs.push(domMembers[d] ?? new Int32Array(0));
}

{
  const byHost = new Map<number, number[]>();
  for (let s = 0; s < labels.subs.length; s++) {
    const h = subHost[s];
    const bucket = byHost.get(h);
    if (bucket) bucket.push(s); else byHost.set(h, [s]);
  }
  for (const subs of byHost.values()) {
    let lead = subs[0], visits = 0;
    for (const s of subs) {
      visits += SUB_VISITS[s];
      if (SUB_VISITS[s] > SUB_VISITS[lead]) lead = s;
    }
    places.push({
      name: labels.subs[lead].replace(/ \[\d+\]$/, "").split("/")[0],
      kind: "subdomain", id: places.length,
      x: anchors.subX[lead], y: anchors.subY[lead],
      r: (A.sub_r as Float32Array)[lead],
      visits,
    });
    placeSubs.push(Int32Array.from(subs));
  }
}

/**
 * How wide a place reads on the map: the distance from its anchor that covers
 * most of its pages. A plain max would be set by the one page that drifted to
 * the far side of the world, so this takes a high quantile instead — the
 * cluster you can see, not the group's full membership.
 */
const SPREAD_QUANTILE = 0.6;
const scratch: number[] = [];
function spreadOf(p: SearchPlace): number {
  scratch.length = 0;
  for (const s of placeSubs[p.id]) {
    for (const pg of subPages[s] ?? EMPTY) {
      const dx = (A.page_x as Float32Array)[pg] - p.x;
      const dy = (A.page_y as Float32Array)[pg] - p.y;
      scratch.push(Math.hypot(dx, dy));
    }
  }
  if (!scratch.length) return MR_SUB;
  scratch.sort((a, b) => a - b);
  const q = scratch[Math.min(scratch.length - 1,
                             Math.floor(scratch.length * SPREAD_QUANTILE))];
  return Math.max(q, MR_PAGE * 4);
}

/**
 * Landing needs a page, not just a coordinate: the district highlight is keyed
 * on the hovered building, so arriving marks the place's busiest page and the
 * district lifts around it — the same thing the pointer does.
 */
function busiestPage(p: SearchPlace): number {
  let best = -1, bestHits = -1;
  for (const s of placeSubs[p.id]) {
    for (const pg of subPages[s] ?? EMPTY) {
      if (PAGE_HITS[pg] > bestHits) { bestHits = PAGE_HITS[pg]; best = pg; }
    }
  }
  return best;
}

/**
 * A domain's name is drawn only until the subdomain tier takes over; a
 * subdomain's only from that point until the page tier takes over. Flying
 * outside a place's own window arrives somewhere unlabelled, so inverting the
 * same step functions the label layer uses gives the zooms to stay between.
 * The lift off each edge is so the tier is comfortably in, not just switching.
 */
const EDGE = 1.06;
const K_SUB_IN = kAt(LOD_SUB, MR_SUB, TIER_SUB);
const K_PAGE_IN = kAt(LOD_PAGE, MR_PAGE, TIER_PAGE);
/**
 * Within its tier a place still only earns a name once its own footprint is
 * wide enough to sit one on, so that is the real floor — the tier boundary
 * only says which list the place is drawn from.
 */
const footIn = (p: SearchPlace) =>
  (labelLayer.minFootprint * 1.3) / Math.max(p.r * 2, 1e-6);
const labelWindow = (p: SearchPlace): [number, number] => {
  const lo = Math.max(footIn(p), p.kind === "domain" ? 0 : K_SUB_IN * EDGE);
  const hi = p.kind === "domain" ? K_SUB_IN / EDGE : K_PAGE_IN / EDGE;
  return [lo, Math.max(lo, hi)];
};

const search = new MapSearch({
  cam,
  places,
  spreadOf,
  labelWindow,
  onFrame: () => { syncURL(); draw(); },
  onArrive: (p) => {
    hoverPage = busiestPage(p);
    landing = { x: p.x, y: p.y, r: spreadOf(p), name: p.name, t0: performance.now() };
    draw();
  },
});
const initialQuery = q.get("q");
if (initialQuery) search.jump(initialQuery);

const devPanel = new DevPanel(theme, boot0.preset, { onChange: applyTheme, canvas });
if (q.get("dev") === "1") devPanel.setOpen(true);

// Force a route without a pointer, so it can be screenshotted: ?route=a,b
if (q.get("route")) {
  const [pa, pb] = (q.get("route") as string).split(",").map(Number);
  // Snap to a building that is actually drawn. Roughly a quarter of pages
  // lose their cell to a busier neighbour, and clicking can never select one
  // of those — but a hand-written ?route= can, and then the ends are invisible.
  const snap = (p: number) => {
    if (p < 0) return -1;
    const M = baked;
    const c0 = Math.floor(((A.page_x as Float32Array)[p] - M.x0) / M.cellW);
    const r0 = Math.floor(((A.page_y as Float32Array)[p] - M.y0) / M.cellH);
    for (let rad = 0; rad <= 30; rad++) {
      for (let dy = -rad; dy <= rad; dy++) {
        for (let dx = -rad; dx <= rad; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== rad) continue;
          const y = r0 + dy, x = c0 + dx;
          if (y < 0 || x < 0 || y >= M.rows || x >= M.cols) continue;
          const o = M.owner[y * M.cols + x];
          if (o >= 0) return o;
        }
      }
    }
    return -1;
  };
  if (Number.isFinite(pa) && Number.isFinite(pb)) {
    fromPage = snap(pa); toPage = snap(pb);
    if (q.get("mode")) mode = q.get("mode") as Mode;
    solve();
    renderRoutes();
    // only frame the route if the caller did not ask for a specific view
    const xs = (A.page_x as Float32Array), ys = (A.page_y as Float32Array);
    if (!q.get("at") && fromPage >= 0 && toPage >= 0) {
      cam.cx = (xs[fromPage] + xs[toPage]) / 2;
      cam.cy = (ys[fromPage] + ys[toPage]) / 2;
    }
    draw();
  }
}

// Force a district highlight without a pointer, so it can be screenshotted.
if (q.get("hover")) {
  hoverPage = parseInt(q.get("hover") as string, 10) | 0;
  const hx = (A.page_x as Float32Array)[hoverPage];
  const hy = (A.page_y as Float32Array)[hoverPage];
  if (Number.isFinite(hx)) { cam.cx = hx; cam.cy = hy; }
  draw();
  showTip(hoverPage, 12, cam.H - 90);
}

// Audit the hover invariant. A building is no longer one cell, so every cell
// of one must name the same page, and no drawn building may be ownerless.
if (q.get("ownercheck")) {
  let bld = 0, orphan = 0, owned = 0, mismatch = 0;
  const seenOwner = new Map<number, number>();
  for (let i = 0; i < baked.land.length; i++) {
    const g = baked.land[i];
    if (!g || g >= LM_TREE) continue;
    bld++;
    const o = baked.owner[i];
    if (o < 0) { orphan++; continue; }
    owned++;
    const prev = seenOwner.get(o);
    if (prev === undefined) seenOwner.set(o, g);
    else if (prev !== g) mismatch++;
  }
  document.title = [
    `buildingCells ${bld}`,
    `owned ${owned}`,
    `ORPHAN ${orphan}`,
    `distinctPages ${seenOwner.size}`,
    `glyphMismatch ${mismatch}`,
    `meanCellsPerBuilding ${(owned / Math.max(seenOwner.size, 1)).toFixed(2)}`,
  ].join(" | ");
}

if (q.get("dumpgrid")) {
  // Dump a crop of the baked terrain grid so it can be analysed offline.
  // Needed to tell a real pattern in the grid apart from an artefact the
  // renderer introduces on top of it.
  const [gx, gy, gw] = (q.get("dumpgrid") as string).split(",").map(Number);
  const cx = Math.floor((gx - baked.x0) / baked.cellW);
  const cy = Math.floor((gy - baked.y0) / baked.cellH);
  const w = gw || 256;
  const half = w >> 1;
  const out = new Uint8Array(w * w * 2);
  for (let r = 0; r < w; r++) {
    for (let c = 0; c < w; c++) {
      const yy = cy - half + r, xx = cx - half + c;
      const ok = yy >= 0 && xx >= 0 && yy < baked.rows && xx < baked.cols;
      const i = ok ? yy * baked.cols + xx : -1;
      out[r * w + c] = i >= 0 ? baked.land[i] : 0;
      out[w * w + r * w + c] = i >= 0 ? baked.roadLvl[i] : 0;
    }
  }
  let bin = "";
  for (let i = 0; i < out.length; i++) bin += String.fromCharCode(out[i]);
  const el = document.createElement("pre");
  el.id = "griddump";
  el.textContent = `${w}|${btoa(bin)}`;
  el.style.display = "none";
  document.body.appendChild(el);
}

if (q.get("stats")) {
  // How much of the visible ink is road, and how much is buildings?
  const inkOf = (glyph: string, font: string) => {
    const c = document.createElement("canvas");
    c.width = 32; c.height = 32;
    const x = c.getContext("2d", { willReadFrequently: true })!;
    x.fillStyle = "#000"; x.fillRect(0, 0, 32, 32);
    x.font = `24px ${font}, monospace`;
    x.textBaseline = "top"; x.fillStyle = "#fff";
    x.fillText(glyph, 2, 2);
    const d = x.getImageData(0, 0, 32, 32).data;
    let sum = 0;
    for (let i = 0; i < d.length; i += 4) sum += d[i];
    return sum / (255 * 32 * 32);
  };
  const gInk = LANDMARKS.map((g) => (g === " " ? 0 : inkOf(g, "MEKDings")));
  const rInk = inkOf(ROAD.h, "MEKDings");

  let road = 0, bld = 0, wild = 0, nBld = 0, nRoad = 0;
  for (let i = 0; i < baked.land.length; i++) {
    const g = baked.land[i];
    if (g) {
      const a = g >= LM_WTREE ? ren.theme.wildGain
              : g >= LM_TREE ? ren.theme.countrysideGain : ren.theme.buildingGain;
      if (g >= LM_TREE) wild += gInk[g] * a; else { bld += gInk[g] * a; nBld++; }
    }
    const l = baked.roadLvl[i];
    if (l) {
      road += rInk * ren.theme.roadGain * Math.pow(l / ROAD_LEVELS, 1.9);
      nRoad++;
    }
  }
  const tot = road + bld + wild;
  const pc = (v: number) => (100 * v).toFixed(1) + "%";
  document.title = [
    `grid ${baked.cols}x${baked.rows}`,
    `buildings ${nBld}`,
    `bldCells ${pc(nBld / baked.land.length)}`,
    `roadCells ${pc(nRoad / baked.land.length)}`,
    `INK road ${pc(road / tot)} / bld ${pc(bld / tot)} / green ${pc(wild / tot)}`,
  ].join(" | ");
}

if (q.get("perf")) {
  const bench = (label: string, k: number) => {
    cam.k = cam.kFit * k;
    ren.ops = { cells: 0, fills: 0 };
    paint();
    const o = ren.ops;
    const fmtN = (v: number) => v >= 1e6 ? (v / 1e6).toFixed(1) + "M"
                              : v >= 1e3 ? (v / 1e3).toFixed(0) + "k" : String(v);
    return `${label} ${fmtN(o.cells)}c/${fmtN(o.fills)}f${ren.usedCache ? "*" : ""}`;
  };
  const out: string[] = [];
  interacting = false;
  const t0 = performance.now();
  ren.buildCache({ showRoads });
  out.push(`cacheBuild ${((performance.now() - t0) | 0)}ms`);
  ren.forceLive = true;
  out.push(bench("LIVE fit", 1), bench("LIVE 4x", 4));
  ren.forceLive = false;
  out.push(bench("fit", 1), bench("4x", 4), bench("20x", 20), bench("80x", 80));
  interacting = true;
  out.push(bench("drag@fit", 1), bench("drag@4x", 4),
           bench("drag@20x", 20), bench("drag@80x", 80));
  interacting = false;
  document.title = out.join(" | ");
}

