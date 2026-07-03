// ABOUTME: Types for the shared world map: sites in the world, per-person exploration
// ABOUTME: records, and the graded reveal tiers that drive fog-of-war rendering.

export interface WorldSite {
  domain: string;
  /** Relative weight of how much life this place holds (persisted bytes, time, etc.) */
  activity: number;
  /** Number of playhtml rooms under this domain, if known */
  rooms?: number;
  /** Whether this domain is playhtml-connected (renders as a lit landmark) */
  playhtml?: boolean;
  /** Baked world coordinates from the layout tool; hash fallback when absent */
  x?: number;
  y?: number;
  /** How much site exists (page count estimate) -- drives island footprint */
  extent?: number;
  /** Year the place first existed on the web (registration or first archive) */
  founded?: number;
  /** Site's own title, shown alongside the domain */
  title?: string;
}

/** A drawn connection between two sites (a hyperlink route between islands) */
export type Route = [string, string];

/**
 * 0 unseen: blank parchment, nothing drawn
 * 1 glimpsed: faint silhouette, no label
 * 2 visited: inked landmark + label
 * 3 inhabited: full landmark, larger clearing, details on hover
 */
export type RevealTier = 0 | 1 | 2 | 3;

export interface ExplorationEntry {
  tier: RevealTier;
  visits?: number;
  timeMs?: number;
  firstSeen?: number;
}

/** Keyed by domain */
export type ExplorationRecord = Record<string, ExplorationEntry>;

/** A patch of fog cleared by scouting, in world coordinates */
export interface ScoutMark {
  x: number;
  y: number;
  r: number;
}
