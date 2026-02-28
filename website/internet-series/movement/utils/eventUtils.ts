// ABOUTME: Shared utility functions for event processing across all event types
// ABOUTME: Contains color palette, hashing, and domain extraction helpers

// Trail color palette — 8 evenly-spaced HSL hues (45° apart) with warm
// saturation and constrained lightness. Inspired by minute-faces' time-color
// mapping: vivid, harmonious, and legible over both light and dark backgrounds.
export const RISO_COLORS = [
  "hsl(10, 72%, 48%)",   // warm red
  "hsl(55, 68%, 42%)",   // amber
  "hsl(100, 55%, 40%)",  // moss green
  "hsl(155, 60%, 38%)",  // teal
  "hsl(210, 65%, 45%)",  // steel blue
  "hsl(260, 55%, 48%)",  // violet
  "hsl(310, 58%, 45%)",  // magenta
  "hsl(35, 70%, 45%)",   // burnt orange
];

// Luminosity for radial nodes (slime blobs). 1 = unchanged; >1 = brighter; <1 = darker.
export const RADIAL_PALETTE_LUMINOSITY = 1.8;
// Luminosity for radial edges (paths between nodes). Independent of node luminosity.
export const RADIAL_EDGE_LUMINOSITY = 1.2;

const RADIAL_ORGANIC_BASE: [number, number, number][] = [
  [98, 115, 78], // sage green
  [100, 108, 82], // moss
  [132, 118, 92], // lichen / stone
  [108, 102, 82], // bark
  [115, 112, 92], // stone-gray
  [140, 95, 72], // rusty clay
  [145, 115, 75], // amber / honey
  [128, 98, 82], // dried orange
  [95, 98, 115], // slate / lavender-gray
  [92, 88, 108], // heather
  [88, 95, 105], // blue-gray moss
];

function scaleRgb([r, g, b]: [number, number, number], scale: number): string {
  const clamp = (n: number) =>
    Math.round(Math.min(255, Math.max(0, n * scale)));
  return `rgb(${clamp(r)}, ${clamp(g)}, ${clamp(b)})`;
}

/** Slime-mold palette for nodes (RADIAL_PALETTE_LUMINOSITY) */
export const RADIAL_ORGANIC_COLORS = RADIAL_ORGANIC_BASE.map((rgb) =>
  scaleRgb(rgb, RADIAL_PALETTE_LUMINOSITY),
);

/** Same hues as nodes but scaled by RADIAL_EDGE_LUMINOSITY (for edge strokes) */
export const RADIAL_EDGE_COLORS = RADIAL_ORGANIC_BASE.map((rgb) =>
  scaleRgb(rgb, RADIAL_EDGE_LUMINOSITY),
);

/**
 * Hash a participant ID to a number for consistent color assignment
 */
export function hashParticipantId(pid: string): number {
  let hash = 0;
  for (let i = 0; i < pid.length; i++) {
    const char = pid.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash;
  }
  return Math.abs(hash);
}

/**
 * Get a consistent color for a participant based on their ID
 */
export function getColorForParticipant(pid: string): string {
  const hash = hashParticipantId(pid);
  return RISO_COLORS[hash % RISO_COLORS.length];
}

/**
 * Extract the domain from a URL, removing 'www.' prefix
 */
export function extractDomain(url: string): string {
  if (!url) return "";
  try {
    const urlObj = new URL(url.startsWith("http") ? url : `https://${url}`);
    return urlObj.hostname.replace("www.", "");
  } catch {
    return "";
  }
}

// Constants used across event processing
export const TRAIL_TIME_THRESHOLD = 300000; // 5 minutes - gap that breaks a trail into separate trails
export const SCROLL_SESSION_THRESHOLD = 900000; // 15 minutes - gap that breaks scroll sessions
export const SCROLL_TIME_COMPRESSION = 0.1; // Compress scroll timing to 10% of real time
export const MAX_VIEWPORT_ANIMATION_DURATION = 30000; // Cap each viewport animation at 30 seconds
