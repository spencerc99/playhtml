// ABOUTME: Shared utility functions for event processing across all event types
// ABOUTME: Contains color palette, hashing, and domain extraction helpers

// Trail color palette — 8 evenly-spaced HSL hues (45° apart) with warm
// saturation and constrained lightness. Inspired by minute-faces' time-color
// mapping: vivid, harmonious, and legible over both light and dark backgrounds.
export const RISO_COLORS = [
  "rgb(0, 120, 191)", // Blue
  "rgb(255, 102, 94)", // Bright Red
  "rgb(0, 169, 92)", // Green
  "rgb(255, 123, 75)", // Orange
  "rgb(146, 55, 141)", // Purple
  "rgb(255, 232, 0)", // Yellow
  "rgb(255, 72, 176)", // Fluorescent Pink
  "rgb(0, 131, 138)", // Teal
];
// Tunable constants for time-based color derivation from a participant's
// chosen cursor color. Inspired by minute-faces' time-of-day color model.
// TODO: right now its too extreme because the adjustments happen linearly. so its hard to recognize yours
// ideally it would be more of a normal distribution so most of the stuff looks just like your color?
export const SESSION_HUE_CONFIG = {
  // Hue offset cycles fully each hour within this range (+/- half)
  HOUR_HUE_RANGE: 5,
  // Saturation offset cycles each hour between min and max
  HOUR_SAT_MIN: -5,
  HOUR_SAT_MAX: 5,
  // Lightness offset driven by hour-of-day (midnight = min, noon = max)
  DAY_LIGHT_MIN: -7,
  DAY_LIGHT_MAX: 15,
};

/**
 * Parse a color string to { h, s, l } (h: 0-360, s: 0-100, l: 0-100).
 * Accepts #RGB, #RRGGBB, or hsl(...) strings.
 */
export function parseColorToHsl(
  color: string,
): { h: number; s: number; l: number } | null {
  // Handle hsl() strings
  const hslMatch = color.match(
    /^hsl\(\s*(\d+)\s*,\s*(\d+)%?\s*,\s*(\d+)%?\s*\)$/,
  );
  if (hslMatch) {
    return {
      h: parseInt(hslMatch[1]),
      s: parseInt(hslMatch[2]),
      l: parseInt(hslMatch[3]),
    };
  }

  // Handle hex strings
  let hex = color.replace("#", "");
  if (hex.length === 3)
    hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
  if (hex.length !== 6) return null;

  const r = parseInt(hex.slice(0, 2), 16) / 255;
  const g = parseInt(hex.slice(2, 4), 16) / 255;
  const b = parseInt(hex.slice(4, 6), 16) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (max === g) h = ((b - r) / d + 2) / 6;
    else h = ((r - g) / d + 4) / 6;
  }

  return {
    h: Math.round(h * 360),
    s: Math.round(s * 100),
    l: Math.round(l * 100),
  };
}

/**
 * Derive a time-varying color from a participant's base color and an event timestamp.
 *
 * - Hue + saturation cycle within their ranges each hour (driven by minute-of-hour)
 * - Lightness varies across the day (darker at midnight, lighter at noon)
 *
 * Uses the participant's local timezone if available, otherwise UTC.
 */
export function deriveSessionColor(
  baseColor: string,
  timestamp: number,
  timezone?: string,
): string {
  const base = parseColorToHsl(baseColor);
  if (!base) return baseColor; // Unparseable — return as-is

  const date = new Date(timestamp);
  let hour: number;
  let minute: number;
  if (timezone) {
    try {
      const parts = new Intl.DateTimeFormat("en-US", {
        timeZone: timezone,
        hour: "numeric",
        minute: "numeric",
        hour12: false,
      }).formatToParts(date);
      hour = parseInt(parts.find((p) => p.type === "hour")?.value ?? "0");
      minute = parseInt(parts.find((p) => p.type === "minute")?.value ?? "0");
    } catch {
      hour = date.getUTCHours();
      minute = date.getUTCMinutes();
    }
  } else {
    hour = date.getUTCHours();
    minute = date.getUTCMinutes();
  }

  const cfg = SESSION_HUE_CONFIG;

  // Hue: sinusoidal cycle each hour within HOUR_HUE_RANGE
  const minuteFraction = minute / 60;
  const hueOffset =
    Math.sin(minuteFraction * Math.PI * 2) * (cfg.HOUR_HUE_RANGE / 2);

  // Saturation: cosine cycle each hour between HOUR_SAT_MIN and HOUR_SAT_MAX
  const satOffset =
    cfg.HOUR_SAT_MIN +
    (cfg.HOUR_SAT_MAX - cfg.HOUR_SAT_MIN) *
      (0.5 + 0.5 * Math.cos(minuteFraction * Math.PI * 2));

  // Lightness: cosine across 24h, peak at noon (hour 12), trough at midnight (hour 0)
  const hourFraction = (hour + minute / 60) / 24;
  const lightOffset =
    cfg.DAY_LIGHT_MIN +
    (cfg.DAY_LIGHT_MAX - cfg.DAY_LIGHT_MIN) *
      (0.5 + 0.5 * Math.cos((hourFraction - 0.5) * Math.PI * 2));

  const h = (((base.h + hueOffset) % 360) + 360) % 360;
  const s = Math.max(0, Math.min(100, base.s + satOffset));
  const l = Math.max(0, Math.min(100, base.l + lightOffset));

  return `hsl(${Math.round(h)}, ${Math.round(s)}%, ${Math.round(l)}%)`;
}

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
