// ABOUTME: Pure SVG rendering + geometry for quarantine tape — no state, no listeners, just drawing.
// ABOUTME: Ported faithfully from the tuned prototype (caution-tape ribbon, hazard slashes, torn ends, rips).

import type { EdgePoint, TapeType, Wall } from "./types";

const SVGNS = "http://www.w3.org/2000/svg";

const EDGE_HIT = 64; // px band from a viewport edge that counts as "on the wall"
const TAPE_WIDTH = 38; // px visual width of a strip
const HATCH_TILE = 16; // px hatch repeat along the strip
const TEXT_TILE = 132; // px between repeated labels along the strip

interface TapeStyle {
  label: string; // the repeated text printed down the tape
  base: string; // clean plastic band the text sits on
  mark: string; // hazard hatching color (edge borders)
  ink: string; // printed-text color
}

export const TYPE_STYLE: Record<TapeType, TapeStyle> = {
  // AI SLOP — amber/orange tape, black hazard slashes + black text (DANGER style)
  slop: { label: "AI SLOP", base: "#f0a92b", mark: "#161616", ink: "#161616" },
  // SEO SPAM — white tape, red hazard slashes + red text (DO NOT CROSS style)
  spam: { label: "SEO SPAM", base: "#f6f1ea", mark: "#d62828", ink: "#d62828" },
};

// ----- viewport helpers -----
export function vw() {
  return window.innerWidth;
}
export function vh() {
  return window.innerHeight;
}

export function clamp01(n: number) {
  return Math.max(0, Math.min(1, n));
}

export function pointToXY(p: EdgePoint): { x: number; y: number } {
  const W = vw(),
    H = vh();
  switch (p.wall) {
    case "top":
      return { x: p.t * W, y: 0 };
    case "bottom":
      return { x: p.t * W, y: H };
    case "left":
      return { x: 0, y: p.t * H };
    case "right":
      return { x: W, y: p.t * H };
  }
}

export function snapToWall(x: number, y: number): EdgePoint | null {
  const W = vw(),
    H = vh();
  const dTop = y,
    dBottom = H - y,
    dLeft = x,
    dRight = W - x;
  const min = Math.min(dTop, dBottom, dLeft, dRight);
  if (min > EDGE_HIT) return null;
  if (min === dTop) return { wall: "top", t: clamp01(x / W) };
  if (min === dBottom) return { wall: "bottom", t: clamp01(x / W) };
  if (min === dLeft) return { wall: "left", t: clamp01(y / H) };
  return { wall: "right", t: clamp01(y / H) };
}

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/**
 * If segment P1→P2 crosses segment A→B, return the crossing's position along
 * A→B as a 0..1 fraction (tOnStrip). Otherwise null.
 */
export function segmentCross(
  p1: { x: number; y: number },
  p2: { x: number; y: number },
  a: { x: number; y: number },
  b: { x: number; y: number },
): { tOnStrip: number } | null {
  const r = { x: p2.x - p1.x, y: p2.y - p1.y };
  const s = { x: b.x - a.x, y: b.y - a.y };
  const denom = r.x * s.y - r.y * s.x;
  if (Math.abs(denom) < 1e-6) return null; // parallel
  const qp = { x: a.x - p1.x, y: a.y - p1.y };
  const t = (qp.x * s.y - qp.y * s.x) / denom; // along the slash
  const u = (qp.x * r.y - qp.y * r.x) / denom; // along the strip
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return { tOnStrip: u };
}

// ===========================================================================
// Shared <defs> — created ONCE. The sheen + shadow are shared filters. Per-strip
// we only build cheap geometry (no new patterns/filters per render).
// ===========================================================================
export function buildSharedDefs(defs: SVGDefsElement) {
  // plastic sheen — vertical gradient across the tape width (local space)
  const sheen = document.createElementNS(SVGNS, "linearGradient");
  sheen.id = "tape-sheen";
  sheen.setAttribute("x1", "0");
  sheen.setAttribute("y1", "0");
  sheen.setAttribute("x2", "0");
  sheen.setAttribute("y2", "1");
  const stops: Array<[string, string, string]> = [
    ["0", "#ffffff", "0.4"],
    ["0.22", "#ffffff", "0.05"],
    ["0.55", "#000000", "0.04"],
    ["1", "#000000", "0.28"],
  ];
  for (const [off, col, op] of stops) {
    const s = document.createElementNS(SVGNS, "stop");
    s.setAttribute("offset", off);
    s.setAttribute("stop-color", col);
    s.setAttribute("stop-opacity", op);
    sheen.appendChild(s);
  }
  defs.appendChild(sheen);

  // single shared drop shadow (cheap — no per-strip filters, no turbulence)
  const shadow = document.createElementNS(SVGNS, "filter");
  shadow.id = "tape-shadow";
  shadow.setAttribute("x", "-10%");
  shadow.setAttribute("y", "-200%");
  shadow.setAttribute("width", "120%");
  shadow.setAttribute("height", "500%");
  const ds = document.createElementNS(SVGNS, "feDropShadow");
  ds.setAttribute("dx", "0");
  ds.setAttribute("dy", "2");
  ds.setAttribute("stdDeviation", "2.5");
  ds.setAttribute("flood-color", "#000");
  ds.setAttribute("flood-opacity", "0.3");
  shadow.appendChild(ds);
  defs.appendChild(shadow);
}

/**
 * A warning triangle (⚠) drawn in local strip space, centered on (cx, 0).
 * `flip` rotates it 180° to stay upright on past-vertical strips.
 */
function warningTriangle(cx: number, color: string, flip: boolean): SVGGElement {
  const g = document.createElementNS(SVGNS, "g");
  const s = 9; // half-extent
  const tri = document.createElementNS(SVGNS, "path");
  // rounded-ish triangle outline
  tri.setAttribute("d", `M ${cx},${-s} L ${cx + s},${s} L ${cx - s},${s} Z`);
  tri.setAttribute("fill", "none");
  tri.setAttribute("stroke", color);
  tri.setAttribute("stroke-width", "2");
  tri.setAttribute("stroke-linejoin", "round");
  g.appendChild(tri);
  // exclamation: stem + dot
  const stem = document.createElementNS(SVGNS, "line");
  stem.setAttribute("x1", String(cx));
  stem.setAttribute("y1", String(-s * 0.1));
  stem.setAttribute("x2", String(cx));
  stem.setAttribute("y2", String(s * 0.45));
  stem.setAttribute("stroke", color);
  stem.setAttribute("stroke-width", "2");
  stem.setAttribute("stroke-linecap", "round");
  g.appendChild(stem);
  const dot = document.createElementNS(SVGNS, "circle");
  dot.setAttribute("cx", String(cx));
  dot.setAttribute("cy", String(s * 0.72));
  dot.setAttribute("r", "1.2");
  dot.setAttribute("fill", color);
  g.appendChild(dot);
  if (flip) g.setAttribute("transform", `rotate(180 ${cx} 0)`);
  return g;
}

// ===========================================================================
// Build ONE tape strip as a <g> drawn in LOCAL space (length along +x, width
// centered on y=0), then translate+rotate it into place. Everything inside —
// hatch fill, sheen, torn ends, repeated text — is authored horizontally so it
// looks identical at every on-screen angle. No per-strip patterns or filters.
// ===========================================================================
export function buildTapeGroup(
  defs: SVGDefsElement,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  type: TapeType,
  seed: number,
  opacity: number,
  provisional: boolean,
  rips: number[] = [],
  fullyTorn = false,
): SVGGElement {
  const style = TYPE_STYLE[type];
  const dx = bx - ax,
    dy = by - ay;
  const len = Math.max(1, Math.hypot(dx, dy));
  const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
  const hw = TAPE_WIDTH / 2;
  const rand = rng(seed);

  const grp = document.createElementNS(SVGNS, "g");
  grp.setAttribute("transform", `translate(${ax} ${ay}) rotate(${angle})`);
  grp.setAttribute("opacity", String(opacity));
  grp.setAttribute("filter", "url(#tape-shadow)");

  // torn-end cap: small jagged horizontal offset at x≈0 and x≈len
  // Both ends overshoot the wall so the tape always runs fully off-screen; the
  // torn jaggedness only ever pushes FURTHER out (dir), never back inward, so
  // there's never a gap between the cap and the viewport edge.
  const OVERSHOOT = 14;
  const tear = (atX: number, dir: number): string => {
    const steps = 5;
    let pts = "";
    for (let i = 0; i <= steps; i++) {
      const f = i / steps;
      const base = atX + OVERSHOOT * dir; // past the edge
      const jag = rand() * 8 * dir; // outward-only ripping
      const x = base + jag;
      const y = -hw + TAPE_WIDTH * f;
      pts += `${x.toFixed(1)},${y.toFixed(1)} `;
    }
    return pts.trim();
  };
  const capA = tear(0, -1)
    .split(" ")
    .map((p) => p.split(",").map(Number));
  const capB = tear(len, 1)
    .split(" ")
    .map((p) => p.split(",").map(Number));

  // ribbon outline in local space, walked as: top-left → top-right → down the
  // right torn cap → bottom-right → bottom-left → up the left torn cap.
  let d = `M ${capA[0][0]},${-hw} `;
  d += `L ${capB[0][0]},${-hw} `; // top edge
  for (const [px, py] of capB) d += `L ${px},${py} `; // right torn cap (top→bottom)
  d += `L ${capA[capA.length - 1][0]},${hw} `; // bottom edge
  for (let i = capA.length - 1; i >= 0; i--) d += `L ${capA[i][0]},${capA[i][1]} `; // left cap (bottom→top)
  d += "Z";

  // unique clip id per strip (geometry only — cheap)
  const clipId = `clip-${seed}-${Math.round(len)}`;
  let clip = defs.querySelector<SVGClipPathElement>(`#${CSS.escape(clipId)}`);
  if (!clip) {
    clip = document.createElementNS(SVGNS, "clipPath");
    clip.id = clipId;
    const cp = document.createElementNS(SVGNS, "path");
    cp.setAttribute("d", d);
    clip.appendChild(cp);
    defs.appendChild(clip);
  }

  // 1) solid plastic base
  const body = document.createElementNS(SVGNS, "path");
  body.setAttribute("d", d);
  body.setAttribute("fill", style.base);
  grp.appendChild(body);

  // 1b) hazard slashes drawn as explicit geometry on the actual top + bottom
  //     edges (local y = ∓hw), clipped to the tape so they never drift into the
  //     center band. Authoring them here (not via a userSpace <pattern>)
  //     guarantees they track the tape edges at any position/angle.
  const hatchG = document.createElementNS(SVGNS, "g");
  hatchG.setAttribute("clip-path", `url(#${clipId})`);
  const band = TAPE_WIDTH * 0.3; // edge-band thickness
  const slashW = HATCH_TILE * 0.5; // bar width
  const x0 = -OVERSHOOT - 8;
  const x1 = len + OVERSHOOT + 8;
  for (let x = x0; x < x1; x += HATCH_TILE) {
    // top band slash (parallelogram leaning forward)
    const top = document.createElementNS(SVGNS, "path");
    top.setAttribute(
      "d",
      `M ${x},${-hw + band} L ${x + slashW},${-hw + band} L ${x + slashW + band},${-hw} L ${x + band},${-hw} Z`,
    );
    top.setAttribute("fill", style.mark);
    hatchG.appendChild(top);
    // bottom band slash
    const bot = document.createElementNS(SVGNS, "path");
    bot.setAttribute(
      "d",
      `M ${x},${hw} L ${x + slashW},${hw} L ${x + slashW + band},${hw - band} L ${x + band},${hw - band} Z`,
    );
    bot.setAttribute("fill", style.mark);
    hatchG.appendChild(bot);
  }
  grp.appendChild(hatchG);

  // 2) sheen
  const sheen = document.createElementNS(SVGNS, "path");
  sheen.setAttribute("d", d);
  sheen.setAttribute("fill", "url(#tape-sheen)");
  grp.appendChild(sheen);

  // 3) repeated label text along the centerline — consistent spacing because we
  //    place each copy at a fixed local interval (no rotation skew, no clipping
  //    at ends because we inset by half a tile).
  const textG = document.createElementNS(SVGNS, "g");
  textG.setAttribute("clip-path", `url(#${clipId})`);
  const count = Math.max(1, Math.round((len - TEXT_TILE * 0.5) / TEXT_TILE));
  const startX = (len - (count - 1) * TEXT_TILE) / 2; // center the row
  const flip = angle > 90 || angle < -90; // keep text from going upside-down
  // halo color: the clean base color, which always contrasts the ink — lifts the
  // label off the edge hatching on either tape.
  const halo = style.base;
  for (let i = 0; i < count; i++) {
    const cx = startX + i * TEXT_TILE;
    const mk = (fill: string, isHalo: boolean) => {
      const t = document.createElementNS(SVGNS, "text");
      t.setAttribute("x", String(cx));
      t.setAttribute("y", "0");
      t.setAttribute("text-anchor", "middle");
      t.setAttribute("dominant-baseline", "central");
      t.setAttribute("font-family", "'Arial Black', Impact, system-ui, sans-serif");
      t.setAttribute("font-size", "14");
      t.setAttribute("font-weight", "900");
      t.setAttribute("letter-spacing", "0.5");
      t.setAttribute("fill", fill);
      if (isHalo) {
        t.setAttribute("stroke", fill);
        t.setAttribute("stroke-width", "4");
        t.setAttribute("stroke-linejoin", "round");
        t.setAttribute("opacity", "0.92");
      }
      if (flip) t.setAttribute("transform", `rotate(180 ${cx} 0)`);
      t.textContent = style.label;
      return t;
    };
    textG.appendChild(mk(halo, true)); // halo underlay
    textG.appendChild(mk(style.ink, false)); // crisp ink on top
    // ⚠ triangle in the gap after this label (not after the last one)
    if (i < count - 1) {
      textG.appendChild(warningTriangle(cx + TEXT_TILE / 2, style.ink, flip));
    }
  }
  grp.appendChild(textG);

  // 4) provisional: dashed outline so a lone flag reads as tentative
  if (provisional) {
    const outline = document.createElementNS(SVGNS, "path");
    outline.setAttribute("d", d);
    outline.setAttribute("fill", "none");
    outline.setAttribute("stroke", style.ink);
    outline.setAttribute("stroke-width", "1");
    outline.setAttribute("stroke-dasharray", "6 5");
    outline.setAttribute("stroke-opacity", "0.5");
    grp.appendChild(outline);
  }

  // 5) rip marks — each slash leaves a jagged gash across the tape (a torn
  //    trace). When fully torn the gashes widen into real gaps and the whole
  //    strip dims + slumps (see caller, which adds the droop).
  if (rips.length) {
    const ripG = document.createElementNS(SVGNS, "g");
    ripG.setAttribute("clip-path", `url(#${clipId})`);
    const gapW = fullyTorn ? 16 : 9; // torn gashes open wider
    for (const r of rips) {
      const rx = r * len;
      const rr = rng((seed ^ Math.round(r * 1000)) >>> 0);
      // jagged tear lines top→bottom on each side of the gap
      const left: string[] = [];
      const right: string[] = [];
      const steps = 7;
      for (let i = 0; i <= steps; i++) {
        const f = i / steps;
        const y = -hw + TAPE_WIDTH * f;
        const jL = (rr() - 0.5) * 9 - gapW / 2;
        const jR = (rr() - 0.5) * 9 + gapW / 2;
        left.push(`${(rx + jL).toFixed(1)},${y.toFixed(1)}`);
        right.push(`${(rx + jR).toFixed(1)},${y.toFixed(1)}`);
      }
      // the gap: page void showing through (dark cast shadow on the page)
      const gap = document.createElementNS(SVGNS, "polygon");
      gap.setAttribute("points", [...left, ...right.slice().reverse()].join(" "));
      gap.setAttribute("fill", "rgba(0,0,0,0.45)");
      ripG.appendChild(gap);
      // torn-paper highlight: a bright ragged lip on each side of the tear so the
      // gash reads even on dark hatching
      for (const edge of [left, right]) {
        const lip = document.createElementNS(SVGNS, "polyline");
        lip.setAttribute("points", edge.join(" "));
        lip.setAttribute("fill", "none");
        lip.setAttribute("stroke", "#fff");
        lip.setAttribute("stroke-width", "2");
        lip.setAttribute("stroke-opacity", "0.55");
        lip.setAttribute("stroke-linejoin", "round");
        ripG.appendChild(lip);
      }
    }
    grp.appendChild(ripG);
  }

  return grp;
}

/** Does segment p1→p2 cross (or start/end inside) the rect? */
export function segmentCrossesRect(
  p1: { x: number; y: number },
  p2: { x: number; y: number },
  r: DOMRect,
): boolean {
  const inside = (p: { x: number; y: number }) =>
    p.x >= r.left && p.x <= r.right && p.y >= r.top && p.y <= r.bottom;
  if (inside(p1) || inside(p2)) return true;
  const corners = [
    { x: r.left, y: r.top },
    { x: r.right, y: r.top },
    { x: r.right, y: r.bottom },
    { x: r.left, y: r.bottom },
  ];
  for (let i = 0; i < 4; i++) {
    if (segmentCross(p1, p2, corners[i], corners[(i + 1) % 4])) return true;
  }
  return false;
}

/** The four viewport edges as [x1,y1,x2,y2] segments, for the armed glow. */
export function edgeSegments(): Array<[number, number, number, number]> {
  const W = vw(),
    H = vh();
  return [
    [0, 0, W, 0],
    [W, 0, W, H],
    [0, H, W, H],
    [0, 0, 0, H],
  ];
}

export type { Wall };
