// ABOUTME: Places settled live cursor trails in a count- or coverage-bounded window and gives each a depth.
// ABOUTME: Maps depth to the dimmed, paper-washed appearance that keeps freshly drawn trails legible on top.

export type SedimentWindowMode = "count" | "coverage";

/** How settled ink recedes as newer trails arrive on top of it.
 *  - opacity: only the opacity ramps down with depth (closest to the old look).
 *  - wash: opacity ramps down and the hue is mixed toward the paper color.
 *  - multiply: settled ink multiplies into whatever is underneath so overlaps
 *    build density instead of covering each other.
 *  - wash-multiply: both of the above. */
export type SedimentStyle = "opacity" | "wash" | "multiply" | "wash-multiply";

/** How actively tracing ink is set apart from the settled field.
 *  - none: the wash alone separates fresh strokes.
 *  - paper: a paper-colored gutter cut under the ink (reads as a white border).
 *  - shade: a soft edge in a darker shade of the trail's own hue.
 *  - weight: the stroke is drawn heavier while tracing and relaxes as it settles. */
export type ActiveEmphasis = "none" | "paper" | "shade" | "weight";
export const ACTIVE_EMPHASIS_MODES: readonly ActiveEmphasis[] = [
  "none",
  "paper",
  "shade",
  "weight",
];

export interface SedimentSettings {
  windowMode: SedimentWindowMode;
  /** Count mode: how many settled trails stay on screen. */
  windowCount: number;
  /** Coverage mode: total settled ink area kept, as a multiple of the screen area. */
  coverageBudget: number;
  style: SedimentStyle;
  /** Opacity factor (relative to the live trail opacity) of the deepest kept trail. */
  floorOpacity: number;
  /** Opacity factor of a trail the moment it has settled. */
  freshOpacity: number;
  /** In the wash styles, how far (0..1) the deepest sediment is mixed toward the paper. */
  maxWash: number;
  /** How actively tracing ink is set apart from dense sediment. */
  activeEmphasis: ActiveEmphasis;
}

export const DEFAULT_SEDIMENT_SETTINGS: SedimentSettings = {
  windowMode: "count",
  windowCount: 100,
  coverageBudget: 1.5,
  style: "wash-multiply",
  floorOpacity: 0.3,
  freshOpacity: 0.55,
  maxWash: 0.7,
  activeEmphasis: "none",
};

/** How much live cursor history to retain upstream of the window: enough
 *  groups for the window plus trails still tracing, and an event budget that
 *  does not silently truncate a full field. */
export function liveTrailAccumulationLimits(
  windowMode: SedimentWindowMode,
  windowCount: number,
): { maxGroups: number; maxEvents: number } {
  const groups =
    windowMode === "coverage"
      ? 240
      : Math.max(60, Math.floor(windowCount) + 40);
  return { maxGroups: groups, maxEvents: Math.max(8000, groups * 150) };
}

export interface SedimentCandidate {
  id: string;
  /** Draw-clock time the trail settled; newer trails sit shallower. */
  settledAt: number;
  /** Approximate on-screen ink area in px², used by coverage mode. */
  inkArea: number;
}

export interface SedimentAssignment {
  /** 0 just settled .. 1 about to leave the window. */
  depth: number;
  /** True when the trail no longer fits in the window and should depart. */
  departs: boolean;
}

/** Rank settled trails newest-first and give each a depth in the window.
 *  Count mode fills the window one trail at a time; coverage mode fills it by
 *  accumulated ink area so a few sprawling trails push older ink out faster
 *  than many small ones. A trail departs once the window is full before it. */
export function assignSedimentDepths(
  candidates: readonly SedimentCandidate[],
  settings: SedimentSettings,
  screenArea: number,
): Map<string, SedimentAssignment> {
  const ordered = [...candidates].sort(
    (a, b) => b.settledAt - a.settledAt || (a.id < b.id ? -1 : 1),
  );
  const result = new Map<string, SedimentAssignment>();

  if (settings.windowMode === "coverage") {
    const budget = Math.max(1, settings.coverageBudget * Math.max(1, screenArea));
    let filled = 0;
    for (const candidate of ordered) {
      const departs = filled >= budget;
      filled += Math.max(0, candidate.inkArea);
      result.set(candidate.id, {
        depth: Math.min(1, filled / budget),
        departs,
      });
    }
    return result;
  }

  const windowCount = Math.max(1, Math.floor(settings.windowCount));
  ordered.forEach((candidate, rank) => {
    result.set(candidate.id, {
      depth: Math.min(1, (rank + 1) / windowCount),
      departs: rank >= windowCount,
    });
  });
  return result;
}

/** Rough ink footprint of a trail: its path length times its stroke width.
 *  Self-overlap is counted twice, which is fine for a budget heuristic. */
export function estimateInkArea(
  points: ReadonlyArray<{ x: number; y: number }>,
  strokeWidth: number,
): number {
  let length = 0;
  for (let i = 1; i < points.length; i++) {
    length += Math.hypot(
      points[i].x - points[i - 1].x,
      points[i].y - points[i - 1].y,
    );
  }
  return length * Math.max(1, strokeWidth);
}

/** Opacity factor for settled ink at `depth`. Eases from the fresh value to
 *  the floor so the most recent settled trails stay readable while the tail
 *  flattens into a faint backdrop. */
export function sedimentOpacity(
  depth: number,
  settings: Pick<SedimentSettings, "freshOpacity" | "floorOpacity">,
): number {
  const d = Math.min(1, Math.max(0, depth));
  const remaining = Math.pow(1 - d, 1.5);
  return (
    settings.floorOpacity +
    (settings.freshOpacity - settings.floorOpacity) * remaining
  );
}

/** How far (0..1) a settled trail's color is mixed toward the paper at `depth`.
 *  Even freshly settled ink takes a little wash so it steps back from the
 *  live trails at once; the rest ramps in with depth up to `maxWash`. */
export function sedimentWashAmount(
  depth: number,
  style: SedimentStyle,
  maxWash: number = DEFAULT_SEDIMENT_SETTINGS.maxWash,
): number {
  if (style !== "wash" && style !== "wash-multiply") return 0;
  const d = Math.min(1, Math.max(0, depth));
  const top = Math.min(1, Math.max(0, maxWash));
  const base = Math.min(top, FRESH_WASH);
  return base + (top - base) * Math.pow(d, 0.7);
}

/** The washed color for settled ink. Dark colors get extra lightening: at the
 *  same mix a navy trail still reads as heavy ink while a yellow one has
 *  already vanished, so the wash is scaled by how dark the color is (up to
 *  1.5x for black) and capped so hue never fully disappears. */
export function sedimentWashColor(
  color: string,
  depth: number,
  style: SedimentStyle,
  maxWash: number = DEFAULT_SEDIMENT_SETTINGS.maxWash,
): string {
  const amount = sedimentWashAmount(depth, style, maxWash);
  if (amount <= 0) return color;
  const darkness = 1 - colorLightness(color);
  const compensated = Math.min(
    MAX_COMPENSATED_WASH,
    amount * (1 + DARK_WASH_BOOST * darkness),
  );
  return washTowardPaper(color, compensated);
}

const shadeCache = new Map<string, string>();

/** A darker shade of `color` for the shade emphasis: mixed toward black so it
 *  reads as the same ink with a deeper edge, never as a separate outline. */
export function shadeOfColor(color: string, amount = 0.35): string {
  const key = `${color}|${amount}`;
  const cached = shadeCache.get(key);
  if (cached !== undefined) return cached;
  const rgb = parseRgb(color);
  const result = rgb
    ? `rgb(${rgb.map((c) => Math.round(c * (1 - amount))).join(", ")})`
    : color;
  shadeCache.set(key, result);
  return result;
}

const lightnessCache = new Map<string, number>();

/** Perceived lightness (0..1, Rec. 601 luma) of a color, cached per color
 *  string, so yellow counts as light and navy as dark. Unparseable colors
 *  count as mid-gray. */
export function colorLightness(color: string): number {
  const cached = lightnessCache.get(color);
  if (cached !== undefined) return cached;
  const rgb = parseRgb(color);
  const lightness = rgb
    ? (0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]) / 255
    : 0.5;
  lightnessCache.set(color, lightness);
  return lightness;
}

const lightEdgeCache = new Map<string, number>();

// Below this perceived lightness a color already reads clearly against the
// pale sediment pile and needs no edge; at or above the upper bound it needs
// the full edge to hold its shape.
const LIGHT_EDGE_MIN_LUMA = 0.6;
const LIGHT_EDGE_MAX_LUMA = 0.92;

/** How strongly a live stroke in `color` needs a darker same-hue edge to stay
 *  legible over pale sediment, 0 (dark enough on its own) .. 1 (nearly paper).
 *  Ramps linearly with perceived lightness; unparseable colors get no edge. */
export function lightInkEdgeStrength(color: string): number {
  const cached = lightEdgeCache.get(color);
  if (cached !== undefined) return cached;
  const lightness = colorLightness(color);
  const strength = Math.min(
    1,
    Math.max(
      0,
      (lightness - LIGHT_EDGE_MIN_LUMA) /
        (LIGHT_EDGE_MAX_LUMA - LIGHT_EDGE_MIN_LUMA),
    ),
  );
  lightEdgeCache.set(color, strength);
  return strength;
}

export function sedimentUsesMultiply(style: SedimentStyle): boolean {
  return style === "multiply" || style === "wash-multiply";
}

// Freshly settled ink already takes this much wash so it steps back at once.
const FRESH_WASH = 0.12;
// Dark colors wash up to this much harder than light ones at the same depth.
const DARK_WASH_BOOST = 0.5;
// However dark and deep, sediment keeps at least this much of its own color.
const MAX_COMPENSATED_WASH = 0.88;
// Wash amounts are quantized so a slowly drifting depth doesn't rewrite the
// path color attribute every frame.
const WASH_STEPS = 24;

// The warm linen page background the trails sit on (see --bg in base.scss).
export const PAPER_RGB: readonly [number, number, number] = [0xfa, 0xf7, 0xf2];
export const PAPER_COLOR = "rgb(250, 247, 242)";

const washCache = new Map<string, string>();

/** Mix `color` toward the paper by `amount` (0 = untouched, 1 = paper).
 *  Quantized and cached so repeated calls per frame are cheap and stable. */
export function washTowardPaper(color: string, amount: number): string {
  const step = Math.round(Math.min(1, Math.max(0, amount)) * WASH_STEPS);
  if (step === 0) return color;
  const key = `${color}|${step}`;
  const cached = washCache.get(key);
  if (cached !== undefined) return cached;

  const rgb = parseRgb(color);
  if (!rgb) {
    washCache.set(key, color);
    return color;
  }
  const t = step / WASH_STEPS;
  const mixed = rgb.map((channel, i) =>
    Math.round(channel + (PAPER_RGB[i] - channel) * t),
  );
  const result = `rgb(${mixed[0]}, ${mixed[1]}, ${mixed[2]})`;
  washCache.set(key, result);
  return result;
}

export function parseRgb(input: string): [number, number, number] | null {
  const s = input.trim().toLowerCase();
  if (s === "white") return [255, 255, 255];
  if (s === "black") return [0, 0, 0];

  if (s.startsWith("#")) {
    let hex = s.slice(1);
    if (hex.length === 3) hex = hex.split("").map((c) => c + c).join("");
    if (hex.length !== 6 && hex.length !== 8) return null;
    return [
      parseInt(hex.slice(0, 2), 16),
      parseInt(hex.slice(2, 4), 16),
      parseInt(hex.slice(4, 6), 16),
    ];
  }

  const rgbMatch = s.match(/^rgba?\(\s*([\d.]+)\s*,?\s*([\d.]+)\s*,?\s*([\d.]+)/);
  if (rgbMatch) {
    return [
      Math.round(parseFloat(rgbMatch[1])),
      Math.round(parseFloat(rgbMatch[2])),
      Math.round(parseFloat(rgbMatch[3])),
    ];
  }

  const hslMatch = s.match(
    /^hsla?\(\s*([\d.]+)(?:deg)?\s*,?\s*([\d.]+)%\s*,?\s*([\d.]+)%/,
  );
  if (hslMatch) {
    const h = parseFloat(hslMatch[1]) / 360;
    const sat = parseFloat(hslMatch[2]) / 100;
    const l = parseFloat(hslMatch[3]) / 100;
    if (sat === 0) {
      const v = Math.round(l * 255);
      return [v, v, v];
    }
    const q = l < 0.5 ? l * (1 + sat) : l + sat - l * sat;
    const p = 2 * l - q;
    const hueToRgb = (t: number) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };
    return [
      Math.round(hueToRgb(h + 1 / 3) * 255),
      Math.round(hueToRgb(h) * 255),
      Math.round(hueToRgb(h - 1 / 3) * 255),
    ];
  }

  return null;
}

/** Exponential approach of `current` toward `target` over `dtMs` with time
 *  constant `tauMs`, so depth changes glide instead of stepping. */
export function approachDepth(
  current: number,
  target: number,
  dtMs: number,
  tauMs: number,
): number {
  if (dtMs <= 0 || tauMs <= 0) return target;
  const k = 1 - Math.exp(-dtMs / tauMs);
  const next = current + (target - current) * k;
  return Math.abs(target - next) < 0.0005 ? target : next;
}
