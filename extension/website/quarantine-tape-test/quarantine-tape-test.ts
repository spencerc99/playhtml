// ABOUTME: Throwaway interaction prototype for the quarantine-tape feature (no extension/sync plumbing).
// ABOUTME: Equip a roll, anchor on a glowing viewport edge, pull taut tape, commit on a second edge.

type Wall = "top" | "right" | "bottom" | "left";
type TapeType = "slop" | "spam";

interface EdgePoint {
  wall: Wall;
  t: number; // 0..1 along the wall (left→right for top/bottom, top→bottom for left/right)
}

interface Strip {
  id: string;
  type: TapeType;
  a: EdgePoint;
  b: EdgePoint;
  seed: number; // deterministic tear shape
  rips: number[]; // positions (0..1 along strip) where it's been slashed
  ripsRequired: number | null; // snapshotted at first rip (1 provisional, SET_THRESHOLD set)
}

/**
 * A quarantine on a specific image, keyed by its src URL (the artifact), not by
 * position. Renders as an X of tape across the element's current bounds, so it
 * tracks the element as the page scrolls / reflows.
 */
interface ElementMark {
  id: string;
  type: TapeType;
  src: string; // the artifact URL — what the verdict is actually about
  seed: number;
  rips: number[];
  ripsRequired: number | null;
}

interface TapeStyle {
  label: string; // the repeated text printed down the tape
  base: string; // clean plastic band the text sits on
  mark: string; // hazard hatching color (edge borders)
  ink: string; // printed-text color
}

const TYPE_STYLE: Record<TapeType, TapeStyle> = {
  // AI SLOP — amber/orange tape, black hazard slashes + black text (DANGER style)
  slop: { label: "AI SLOP", base: "#f0a92b", mark: "#161616", ink: "#161616" },
  // SEO SPAM — white tape, red hazard slashes + red text (DO NOT CROSS style)
  spam: { label: "SEO SPAM", base: "#f6f1ea", mark: "#d62828", ink: "#d62828" },
};

const EDGE_HIT = 64; // px band from a viewport edge that counts as "on the wall"
const TAPE_WIDTH = 38; // px visual width of a strip
const HATCH_TILE = 16; // px hatch repeat along the strip
const TEXT_TILE = 132; // px between repeated labels along the strip
const SET_THRESHOLD = 3; // strips on a page → "set" (cordoned); also rips to tear set tape
const SLASH_MIN_LEN = 36; // min drag distance (px) for a slash to count — keeps it heavy/intentional

// ----- state -----
let equipped: TapeType | null = null;
let pending: EdgePoint | null = null; // first anchor placed, waiting for second
let cursor = { x: 0, y: 0 };
const strips: Strip[] = [];
const elementMarks: ElementMark[] = [];
let hoverTarget: HTMLImageElement | null = null; // image under an armed cursor

// ----- DOM / SVG scaffold -----
const SVGNS = "http://www.w3.org/2000/svg";
const overlay = document.createElementNS(SVGNS, "svg");
overlay.setAttribute(
  "style",
  "position:fixed;inset:0;width:100vw;height:100vh;z-index:20;pointer-events:none;overflow:visible;",
);
document.body.appendChild(overlay);

const defs = document.createElementNS(SVGNS, "defs");
overlay.appendChild(defs);
buildSharedDefs();

const gEdges = document.createElementNS(SVGNS, "g");
const gStrips = document.createElementNS(SVGNS, "g");
const gElements = document.createElementNS(SVGNS, "g"); // tape over specific images
const gPreview = document.createElementNS(SVGNS, "g");
overlay.append(gEdges, gStrips, gElements, gPreview);

const hintEl = document.getElementById("hint")!;
const countEl = document.getElementById("count")!;

// ===========================================================================
// Shared <defs> — created ONCE. The hatch is a horizontal pattern (authored in
// local strip space, never re-rotated). The sheen + shadow are shared filters.
// Per-strip we only build cheap geometry (no new patterns/filters per render).
// ===========================================================================
function buildSharedDefs() {

  // plastic sheen — horizontal gradient across the tape width (local space)
  const sheen = document.createElementNS(SVGNS, "linearGradient");
  sheen.id = "tape-sheen";
  sheen.setAttribute("x1", "0"); sheen.setAttribute("y1", "0");
  sheen.setAttribute("x2", "0"); sheen.setAttribute("y2", "1");
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
  shadow.setAttribute("x", "-10%"); shadow.setAttribute("y", "-200%");
  shadow.setAttribute("width", "120%"); shadow.setAttribute("height", "500%");
  const ds = document.createElementNS(SVGNS, "feDropShadow");
  ds.setAttribute("dx", "0"); ds.setAttribute("dy", "2");
  ds.setAttribute("stdDeviation", "2.5");
  ds.setAttribute("flood-color", "#000");
  ds.setAttribute("flood-opacity", "0.3");
  shadow.appendChild(ds);
  defs.appendChild(shadow);
}

// ----- geometry helpers -----
function vw() { return window.innerWidth; }
function vh() { return window.innerHeight; }

function pointToXY(p: EdgePoint): { x: number; y: number } {
  const W = vw(), H = vh();
  switch (p.wall) {
    case "top": return { x: p.t * W, y: 0 };
    case "bottom": return { x: p.t * W, y: H };
    case "left": return { x: 0, y: p.t * H };
    case "right": return { x: W, y: p.t * H };
  }
}

function snapToWall(x: number, y: number): EdgePoint | null {
  const W = vw(), H = vh();
  const dTop = y, dBottom = H - y, dLeft = x, dRight = W - x;
  const min = Math.min(dTop, dBottom, dLeft, dRight);
  if (min > EDGE_HIT) return null;
  if (min === dTop) return { wall: "top", t: clamp01(x / W) };
  if (min === dBottom) return { wall: "bottom", t: clamp01(x / W) };
  if (min === dLeft) return { wall: "left", t: clamp01(y / H) };
  return { wall: "right", t: clamp01(y / H) };
}

function clamp01(n: number) { return Math.max(0, Math.min(1, n)); }

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
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
  stem.setAttribute("x1", String(cx)); stem.setAttribute("y1", String(-s * 0.1));
  stem.setAttribute("x2", String(cx)); stem.setAttribute("y2", String(s * 0.45));
  stem.setAttribute("stroke", color); stem.setAttribute("stroke-width", "2");
  stem.setAttribute("stroke-linecap", "round");
  g.appendChild(stem);
  const dot = document.createElementNS(SVGNS, "circle");
  dot.setAttribute("cx", String(cx)); dot.setAttribute("cy", String(s * 0.72));
  dot.setAttribute("r", "1.2"); dot.setAttribute("fill", color);
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
function buildTapeGroup(
  ax: number, ay: number, bx: number, by: number,
  type: TapeType, seed: number, opacity: number, provisional: boolean,
  rips: number[] = [], fullyTorn = false,
): SVGGElement {
  const style = TYPE_STYLE[type];
  const dx = bx - ax, dy = by - ay;
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
  const capA = tear(0, -1).split(" ").map((p) => p.split(",").map(Number));
  const capB = tear(len, 1).split(" ").map((p) => p.split(",").map(Number));

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

// ----- render passes -----
function renderStrips() {
  // drop stale clip defs from removed strips
  const liveClips = new Set(strips.map((s) => `clip-${s.seed}-`));
  defs.querySelectorAll("[id^='clip-']").forEach((n) => {
    if (![...liveClips].some((p) => n.id.startsWith(p))) n.remove();
  });
  gStrips.replaceChildren();

  // setness counts only strips that aren't fully torn down
  const standing = strips.filter((s) => !isFullyTorn(s));
  const setness = Math.min(1, standing.length / (SET_THRESHOLD + 2));
  const provisional = standing.length < SET_THRESHOLD;
  for (const s of strips) {
    const a = pointToXY(s.a), b = pointToXY(s.b);
    const torn = isFullyTorn(s);
    const opacity = torn ? 0.35 : 0.55 + setness * 0.45;
    gStrips.appendChild(
      buildTapeGroup(a.x, a.y, b.x, b.y, s.type, s.seed, opacity, provisional && !torn, s.rips, torn),
    );
  }

  updateCount(standing.length, provisional);
}

function updateCount(standing: number, provisional: boolean) {
  const word = standing === 1 ? "strip" : "strips";
  const status = standing === 0 ? "" : provisional ? " · provisional" : " · cordoned";
  const tapedImages = new Set(
    elementMarks.filter((m) => !isFullyTorn(m)).map((m) => m.src),
  ).size;
  const imgPart = tapedImages ? ` · ${tapedImages} image${tapedImages === 1 ? "" : "s"}` : "";
  countEl.textContent = `${standing} ${word}${status}${imgPart}`;
}

function isFullyTorn(s: Strip | ElementMark): boolean {
  return s.ripsRequired !== null && s.rips.length >= s.ripsRequired;
}

function makeElementMark(src: string, type: TapeType): ElementMark {
  return {
    id: `e-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    type,
    src,
    seed: (Math.random() * 1e9) | 0,
    rips: [],
    ripsRequired: null,
  };
}

/** Every image on the page that could be taped. */
function tapeableImages(): HTMLImageElement[] {
  return Array.from(document.querySelectorAll<HTMLImageElement>("img")).filter((img) => {
    const r = img.getBoundingClientRect();
    return r.width >= 40 && r.height >= 40;
  });
}

/** Find the live element(s) currently showing a given artifact src. */
function elementsForSrc(src: string): HTMLImageElement[] {
  return tapeableImages().filter((img) => img.src === src);
}

/**
 * Element marks render as an X of two strips across the image's CURRENT bounds,
 * re-measured every render — so the tape tracks the element through scroll and
 * reflow. The verdict itself is keyed by src, not by position.
 */
function renderElementMarks() {
  gElements.replaceChildren();
  const standingStrips = strips.filter((s) => !isFullyTorn(s));
  updateCount(standingStrips.length, standingStrips.length < SET_THRESHOLD);
  const setness = Math.min(1, elementMarks.length / (SET_THRESHOLD + 2));
  for (const m of elementMarks) {
    const torn = isFullyTorn(m);
    // one verdict can paint every copy of that image on the page
    for (const el of elementsForSrc(m.src)) {
      const r = el.getBoundingClientRect();
      if (r.width < 10 || r.height < 10) continue;
      // skip if entirely off-screen (cheap cull)
      if (r.bottom < -200 || r.top > vh() + 200) continue;
      const opacity = torn ? 0.3 : 0.75 + setness * 0.25;
      const inset = 2;
      // an X: TL→BR and TR→BL across the element box
      const diagonals: Array<[number, number, number, number]> = [
        [r.left + inset, r.top + inset, r.right - inset, r.bottom - inset],
        [r.right - inset, r.top + inset, r.left + inset, r.bottom - inset],
      ];
      diagonals.forEach(([x1, y1, x2, y2], i) => {
        gElements.appendChild(
          buildTapeGroup(x1, y1, x2, y2, m.type, m.seed + i * 7717, opacity, false, m.rips, torn),
        );
      });
    }
  }
}

function renderEdges() {
  gEdges.replaceChildren();
  if (!equipped) return;
  const color = TYPE_STYLE[equipped].base;
  const W = vw(), H = vh();
  const edges: Array<[number, number, number, number]> = [
    [0, 0, W, 0], [W, 0, W, H], [0, H, W, H], [0, 0, 0, H],
  ];
  for (const [x1, y1, x2, y2] of edges) {
    const ln = document.createElementNS(SVGNS, "line");
    ln.setAttribute("x1", String(x1)); ln.setAttribute("y1", String(y1));
    ln.setAttribute("x2", String(x2)); ln.setAttribute("y2", String(y2));
    ln.setAttribute("stroke", color);
    ln.setAttribute("stroke-width", "6");
    ln.setAttribute("stroke-opacity", "0.6");
    ln.setAttribute("style", "filter: drop-shadow(0 0 9px " + color + ");");
    gEdges.appendChild(ln);
  }
}

let previewRaf = 0;
function renderPreview() {
  if (previewRaf) return; // coalesce mousemoves to one paint per frame
  previewRaf = requestAnimationFrame(() => {
    previewRaf = 0;
    gPreview.replaceChildren();
    if (!equipped || !pending) return;
    const a = pointToXY(pending);
    const snap = snapToWall(cursor.x, cursor.y);
    const end = snap ? pointToXY(snap) : cursor;
    gPreview.appendChild(buildTapeGroup(a.x, a.y, end.x, end.y, equipped, 7, 0.62, true));

    const nub = document.createElementNS(SVGNS, "circle");
    nub.setAttribute("cx", String(a.x)); nub.setAttribute("cy", String(a.y));
    nub.setAttribute("r", "6"); nub.setAttribute("fill", TYPE_STYLE[equipped].base);
    nub.setAttribute("stroke", "#161616"); nub.setAttribute("stroke-width", "1.5");
    gPreview.appendChild(nub);
  });
}

function setHint() {
  if (!equipped) {
    const standing = strips.filter((s) => !isFullyTorn(s)).length;
    hintEl.textContent = standing
      ? "Pick a roll to add tape — or drag across a strip to rip it."
      : "Pick a tape roll to equip the gun.";
    return;
  }
  if (!pending) {
    hintEl.textContent = hoverTarget
      ? "Drag across this image to tape it as slop."
      : `${TYPE_STYLE[equipped].label} armed — click an edge to anchor, or hover an image.`;
    return;
  }
  hintEl.textContent = "Pull to another edge and click to lay the tape.";
}

// ----- interaction wiring -----
document.querySelectorAll<HTMLElement>(".roll").forEach((el) => {
  el.addEventListener("click", () => {
    const type = el.dataset.type as TapeType;
    equipped = equipped === type ? null : type;
    pending = null;
    document.querySelectorAll<HTMLElement>(".roll").forEach((r) =>
      r.setAttribute("data-armed", String(r.dataset.type === equipped)));
    document.body.classList.toggle("armed", !!equipped);
    if (!equipped) clearHoverTarget();
    renderEdges(); gPreview.replaceChildren(); setHint();
  });
});

window.addEventListener("mousemove", (e) => {
  cursor = { x: e.clientX, y: e.clientY };
  if (equipped && pending) renderPreview();
  if (equipped && !pending) updateHoverTarget(e);
});

/**
 * While armed and not mid-pull, highlight the image under the cursor as a tape
 * target. Dragging across a highlighted image tapes that element instead of
 * stringing a wall-to-wall strip.
 */
function updateHoverTarget(e: MouseEvent) {
  const el = document.elementFromPoint(e.clientX, e.clientY);
  const img =
    el instanceof HTMLImageElement && el.getBoundingClientRect().width >= 40 ? el : null;
  if (img === hoverTarget) return;
  hoverTarget?.classList.remove("qt-target-hover");
  hoverTarget = img;
  if (hoverTarget && equipped) {
    hoverTarget.style.setProperty("--qt-target-color", TYPE_STYLE[equipped].base);
    hoverTarget.classList.add("qt-target-hover");
  }
  setHint();
}

function clearHoverTarget() {
  hoverTarget?.classList.remove("qt-target-hover");
  hoverTarget = null;
}

window.addEventListener("click", (e) => {
  if (!equipped) return;
  // Only swallow clicks on the interactive rolls — the rest of the top wall
  // (even under the toolbar bar) must stay anchorable.
  if ((e.target as HTMLElement).closest(".roll")) return;
  const snap = snapToWall(e.clientX, e.clientY);
  if (!snap) return;
  if (!pending) { pending = snap; setHint(); renderPreview(); return; }
  strips.push({
    id: `s-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    type: equipped,
    a: pending,
    b: snap,
    seed: (Math.random() * 1e9) | 0,
    rips: [],
    ripsRequired: null,
  });
  pending = null;
  gPreview.replaceChildren();
  renderStrips(); setHint();
});

window.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if (pending) { pending = null; gPreview.replaceChildren(); }
  else if (equipped) {
    equipped = null;
    document.querySelectorAll<HTMLElement>(".roll").forEach((r) => r.setAttribute("data-armed", "false"));
    document.body.classList.remove("armed");
    clearHoverTarget();
    renderEdges();
  }
  setHint();
});

// ===========================================================================
// RIP / SLASH gesture (only when NOT armed). Ripping is a heavy, intentional
// drag across a strip — a click won't do it. You drag a stroke; on release, any
// standing strip the stroke crosses takes a rip at the crossing point.
// ===========================================================================
let slashStart: { x: number; y: number } | null = null;
const gSlash = document.createElementNS(SVGNS, "g");
overlay.appendChild(gSlash);

// While armed, a drag that starts on a highlighted image is an element-tape
// gesture (drag across the image to tape it), not a wall anchor.
let elementDragStart: { x: number; y: number; img: HTMLImageElement } | null = null;

// Images are natively draggable: without this the browser hijacks the gesture
// with an HTML5 drag (dragstart fires, mouseup never does) and taping an image
// silently does nothing.
window.addEventListener("dragstart", (e) => {
  if (equipped || slashStart) e.preventDefault();
});

window.addEventListener("mousedown", (e) => {
  if ((e.target as HTMLElement).closest(".toolbar")) return;
  if (equipped) {
    if (hoverTarget) {
      e.preventDefault(); // belt-and-braces against the native image drag
      elementDragStart = { x: e.clientX, y: e.clientY, img: hoverTarget };
      document.body.style.userSelect = "none";
    }
    return; // armed → laying tape, not ripping
  }
  slashStart = { x: e.clientX, y: e.clientY };
  document.body.style.userSelect = "none"; // don't select page text mid-slash
});

window.addEventListener("mousemove", (e) => {
  if (!slashStart) return;
  // draw a live blade trail while dragging
  gSlash.replaceChildren();
  const ln = document.createElementNS(SVGNS, "line");
  ln.setAttribute("x1", String(slashStart.x)); ln.setAttribute("y1", String(slashStart.y));
  ln.setAttribute("x2", String(e.clientX)); ln.setAttribute("y2", String(e.clientY));
  ln.setAttribute("stroke", "#fff");
  ln.setAttribute("stroke-width", "2.5");
  ln.setAttribute("stroke-opacity", "0.85");
  ln.setAttribute("style", "filter: drop-shadow(0 0 4px rgba(0,0,0,0.6));");
  gSlash.appendChild(ln);
});

window.addEventListener("mouseup", (e) => {
  // --- armed: drag across an image tapes that element ---
  const elDrag = elementDragStart;
  elementDragStart = null;
  if (elDrag && equipped) {
    document.body.style.userSelect = "";
    const dist = Math.hypot(e.clientX - elDrag.x, e.clientY - elDrag.y);
    if (dist >= SLASH_MIN_LEN) {
      // First tape on this image creates the verdict; taping an already-taped
      // image adds another layer of corroboration. Same act either way.
      elementMarks.push(makeElementMark(elDrag.img.src, equipped));
      clearHoverTarget();
      renderElementMarks();
      setHint();
    }
    return;
  }

  const start = slashStart;
  slashStart = null;
  gSlash.replaceChildren();
  document.body.style.userSelect = "";
  if (!start) return;
  const end = { x: e.clientX, y: e.clientY };
  const dragLen = Math.hypot(end.x - start.x, end.y - start.y);
  if (dragLen < SLASH_MIN_LEN) return; // too short — not an intentional slash

  let ripped = false;
  for (const s of strips) {
    if (isFullyTorn(s)) continue;
    const a = pointToXY(s.a), b = pointToXY(s.b);
    const hit = segmentCross(start, end, a, b);
    if (!hit) continue;
    // snapshot rips-required at the first rip (locks provisional vs set)
    if (s.ripsRequired === null) {
      const standing = strips.filter((x) => !isFullyTorn(x)).length;
      s.ripsRequired = standing >= SET_THRESHOLD ? SET_THRESHOLD : 1;
    }
    s.rips.push(hit.tOnStrip);
    ripped = true;
  }

  // slashing across a taped image rips that element's verdict
  let elementRipped = false;
  for (const m of elementMarks) {
    if (isFullyTorn(m)) continue;
    const crossed = elementsForSrc(m.src).some((el) => {
      const r = el.getBoundingClientRect();
      return segmentCrossesRect(start, end, r);
    });
    if (!crossed) continue;
    if (m.ripsRequired === null) {
      const layers = elementMarks.filter((x) => x.src === m.src && !isFullyTorn(x)).length;
      m.ripsRequired = layers >= SET_THRESHOLD ? SET_THRESHOLD : 1;
    }
    m.rips.push(0.5);
    elementRipped = true;
  }

  if (ripped) { renderStrips(); setHint(); }
  if (elementRipped) { renderElementMarks(); setHint(); }
});

/**
 * If segment P1→P2 crosses segment A→B, return the crossing's position along
 * A→B as a 0..1 fraction (tOnStrip). Otherwise null.
 */
function segmentCross(
  p1: { x: number; y: number }, p2: { x: number; y: number },
  a: { x: number; y: number }, b: { x: number; y: number },
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

/** Does segment p1→p2 cross (or start inside) the rect? */
function segmentCrossesRect(
  p1: { x: number; y: number }, p2: { x: number; y: number }, r: DOMRect,
): boolean {
  const inside = (p: { x: number; y: number }) =>
    p.x >= r.left && p.x <= r.right && p.y >= r.top && p.y <= r.bottom;
  if (inside(p1) || inside(p2)) return true;
  const corners = [
    { x: r.left, y: r.top }, { x: r.right, y: r.top },
    { x: r.right, y: r.bottom }, { x: r.left, y: r.bottom },
  ];
  for (let i = 0; i < 4; i++) {
    if (segmentCross(p1, p2, corners[i], corners[(i + 1) % 4])) return true;
  }
  return false;
}

// Element tape is bound to content, so it must follow the page as it scrolls.
let scrollRaf = 0;
window.addEventListener("scroll", () => {
  if (scrollRaf) return;
  scrollRaf = requestAnimationFrame(() => {
    scrollRaf = 0;
    renderElementMarks();
  });
}, { passive: true });

window.addEventListener("resize", () => {
  renderEdges(); renderStrips(); renderElementMarks();
});

setHint();
renderStrips();
renderElementMarks();
