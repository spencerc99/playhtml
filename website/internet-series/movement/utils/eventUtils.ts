// ABOUTME: Shared utility functions for event processing across all event types
// ABOUTME: Contains color palette, hashing, and domain extraction helpers

// RISO-inspired color palette used consistently across all event types
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

// Muted organic palette for radial (slime / moss / lichen): olives, sages, lichen grays, earth
export const RADIAL_ORGANIC_COLORS = [
  "rgb(98, 115, 78)",   // sage
  "rgb(118, 128, 88)",   // olive
  "rgb(100, 108, 82)",   // moss
  "rgb(132, 118, 92)",   // lichen / stone
  "rgb(88, 95, 78)",     // dark moss
  "rgb(108, 102, 82)",   // bark
  "rgb(94, 110, 88)",    // forest
  "rgb(115, 112, 92)",   // stone-gray
];

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
