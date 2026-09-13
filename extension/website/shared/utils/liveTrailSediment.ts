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
  /** Draw a paper-colored halo under actively tracing ink so it separates from dense sediment. */
  activeHalo: boolean;
}

export const DEFAULT_SEDIMENT_SETTINGS: SedimentSettings = {
  windowMode: "count",
  windowCount: 80,
  coverageBudget: 1.5,
  style: "opacity",
  floorOpacity: 0.2,
  freshOpacity: 0.55,
  activeHalo: true,
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

/** How far (0..1) a settled trail's color is mixed toward the paper at `depth`. */
export function sedimentWashAmount(depth: number, style: SedimentStyle): number {
  if (style !== "wash" && style !== "wash-multiply") return 0;
  const d = Math.min(1, Math.max(0, depth));
  return MAX_WASH * Math.pow(d, 0.8);
}

export function sedimentUsesMultiply(style: SedimentStyle): boolean {
  return style === "multiply" || style === "wash-multiply";
}

// Deepest sediment keeps almost half of its own color so hue still reads.
const MAX_WASH = 0.55;
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
