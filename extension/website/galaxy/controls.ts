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
   * Fraction of trunk edges shown at full strength at rest, heaviest first.
   * A spanning forest marks about one trunk edge per node, so showing them all
   * buries the map; the remainder fades in as you zoom.
   */
  trunkTier: number;
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
  trunkTier: 0.15,
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
    if (typeof parsed.trunkTier === "number") {
      next.trunkTier = clamp(parsed.trunkTier, 0.02, 1);
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
