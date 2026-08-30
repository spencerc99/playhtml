// ABOUTME: Map display settings, their defaults, and localStorage persistence.
// ABOUTME: Pure state plumbing so the map component stays focused on rendering.

export interface MapSettings {
  /** Index into the grouping hierarchy. */
  groupLevel: number;
  /**
   * Show uncrawled dead-ends (rumors) at rest. Off by default: they are ~80%
   * of the graph and drown the charted network.
   */
  showRumors: boolean;
  /** Multiplies layout spacing; changing it re-solves. */
  spread: number;
  /** Draw only backbone lines, or backbone plus the street mesh. */
  lineMode: "trunk" | "all";
  /** Opacity of the non-trunk mesh underlay. */
  meshOpacity: number;
  /** Tint lines by cluster, or keep everything neutral bone. */
  clusterHues: boolean;
  /** Scales how many labels compete for space. */
  labelDensity: number;
  /** Multiplies stop marker radius. */
  nodeScale: number;
  /** Taper one-way lines from thick source to thin target. */
  directionTapers: boolean;
  /** Dim anything more than N hops from a seed; 0 disables. */
  seedFocusHops: number;
  /**
   * How trips are planned: "streets" allows any road (trunk hops cheaper),
   * "transit" rides the backbone with a walk permitted only as the first
   * and/or last hop.
   */
  routeMode: "streets" | "transit";
  /** Draw the named metro lines over the road network. */
  showLines: boolean;
  /** Whether the lines legend is expanded. */
  legendOpen: boolean;
  /** Line whose colour stays lit while the others dim; null highlights none. */
  focusedLine: string | null;
  /**
   * Route narration detail. "express" lists only boarding, transfers and
   * arrival; "local" also names every intermediate station of each ride.
   */
  routeDetail: "express" | "local";
  /**
   * Steepness of the drainage ramp. Width and alpha follow flow01 raised to
   * this power, so a higher value pushes more of the map into whisper-thin
   * capillaries and reserves weight for the true rivers.
   */
  flowExponent: number;
  /** Curve tributaries toward the river they join. */
  bundleTributaries: boolean;
}

export const DEFAULT_SETTINGS: MapSettings = {
  // Open at the first grouped level: the fringe affordances make collapsed
  // contents legible, and L0 at this scale is an unreadable mat.
  groupLevel: 1,
  showRumors: false,
  spread: 1,
  lineMode: "all",
  meshOpacity: 0.18,
  clusterHues: true,
  labelDensity: 1,
  nodeScale: 1,
  directionTapers: true,
  seedFocusHops: 0,
  routeMode: "streets",
  showLines: true,
  legendOpen: false,
  focusedLine: null,
  routeDetail: "express",
  flowExponent: 3.2,
  bundleTributaries: true,
};

const STORAGE_KEY = "galaxy-map-settings-v1";

function clamp(value: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, value));
}

/**
 * Merge stored settings over the defaults, validating each field. Anything
 * missing or out of range falls back rather than propagating a bad value into
 * the layout, where it would surface as an unexplained blank map.
 */
export function loadSettings(): MapSettings {
  if (typeof localStorage === "undefined") return { ...DEFAULT_SETTINGS };
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
  if (!raw) return { ...DEFAULT_SETTINGS };

  try {
    const parsed = JSON.parse(raw) as Partial<MapSettings>;
    const next = { ...DEFAULT_SETTINGS };
    if (typeof parsed.groupLevel === "number") {
      next.groupLevel = clamp(Math.round(parsed.groupLevel), 0, 3);
    }
    if (typeof parsed.showRumors === "boolean") next.showRumors = parsed.showRumors;
    if (typeof parsed.spread === "number") next.spread = clamp(parsed.spread, 0.4, 6);
    if (parsed.lineMode === "trunk" || parsed.lineMode === "all") {
      next.lineMode = parsed.lineMode;
    }
    if (typeof parsed.meshOpacity === "number") {
      next.meshOpacity = clamp(parsed.meshOpacity, 0, 1);
    }
    if (typeof parsed.clusterHues === "boolean") next.clusterHues = parsed.clusterHues;
    if (typeof parsed.labelDensity === "number") {
      next.labelDensity = clamp(parsed.labelDensity, 0, 3);
    }
    if (typeof parsed.nodeScale === "number") {
      next.nodeScale = clamp(parsed.nodeScale, 0.4, 3);
    }
    if (typeof parsed.directionTapers === "boolean") {
      next.directionTapers = parsed.directionTapers;
    }
    if (typeof parsed.seedFocusHops === "number") {
      next.seedFocusHops = clamp(Math.round(parsed.seedFocusHops), 0, 8);
    }
    if (parsed.routeMode === "streets" || parsed.routeMode === "transit") {
      next.routeMode = parsed.routeMode;
    }
    if (typeof parsed.showLines === "boolean") next.showLines = parsed.showLines;
    if (typeof parsed.legendOpen === "boolean") next.legendOpen = parsed.legendOpen;
    if (typeof parsed.focusedLine === "string" || parsed.focusedLine === null) {
      next.focusedLine = parsed.focusedLine;
    }
    if (parsed.routeDetail === "express" || parsed.routeDetail === "local") {
      next.routeDetail = parsed.routeDetail;
    }
    if (typeof parsed.flowExponent === "number") {
      next.flowExponent = clamp(parsed.flowExponent, 0.5, 5);
    }
    if (typeof parsed.bundleTributaries === "boolean") {
      next.bundleTributaries = parsed.bundleTributaries;
    }
    return next;
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings: MapSettings): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // A full or blocked store is not worth interrupting the map for.
  }
}
