/**
 * Core types for the Internet Collection System
 * 
 * These types define the structure for collecting browsing behaviors
 * to power collective artworks.
 */

/**
 * Base event structure - all collectors emit this
 */
export interface CollectionEvent {
  id: string;                    // ULID (sortable, unique)
  type: CollectionEventType;     // Event type
  ts: number;                    // Unix ms timestamp
  data: unknown;                 // Type-specific payload
  meta: EventMeta;
}

/**
 * Event types that can be collected
 */
export type CollectionEventType = 
  | 'cursor' 
  | 'click' 
  | 'scroll' 
  | 'screenshot' 
  | 'love';

/**
 * Metadata attached to every event
 */
export interface EventMeta {
  sid: string;      // Session ID (per browser session)
  pid: string;      // Participant ID (anonymous, persistent)
  url: string;      // Current page URL
  vw: number;       // Viewport width
  vh: number;       // Viewport height
  tz: string;       // Timezone (e.g., "America/New_York")
}

/**
 * Cursor-specific payload (compact format)
 */
export interface CursorEventData {
  x: number;        // 0-1 normalized position
  y: number;        // 0-1 normalized position
  t?: string;       // Target element selector (optional)
}

/**
 * Click-specific payload
 */
export interface ClickEventData {
  x: number;        // 0-1 normalized position
  y: number;        // 0-1 normalized position
  button: number;   // Mouse button (0=left, 1=middle, 2=right)
  t?: string;       // Target element selector
}

/**
 * Scroll-specific payload
 */
export interface ScrollEventData {
  x: number;        // Scroll X position
  y: number;        // Scroll Y position
  dx: number;       // Delta X
  dy: number;       // Delta Y
}

/**
 * Collector configuration
 */
export interface CollectorConfig {
  enabled: boolean;
  sampleRate?: number;  // ms between samples (for continuous collectors)
}

/**
 * Collector status information
 */
export interface CollectorStatus {
  type: CollectionEventType;
  enabled: boolean;
  description: string;
  eventsCollected?: number;
}

/**
 * Generate ULID (Universally Unique Lexicographically Sortable Identifier)
 * Simple implementation - for production consider using a library
 */
export function generateULID(): string {
  const now = Date.now();
  const random = Math.random().toString(36).substring(2, 15);
  return `${now.toString(36)}-${random}`;
}

/**
 * Normalize cursor position to 0-1 range (viewport-independent)
 */
export function normalizePosition(
  x: number, 
  y: number, 
  viewportWidth: number, 
  viewportHeight: number
): { x: number; y: number } {
  return {
    x: Math.max(0, Math.min(1, x / viewportWidth)),
    y: Math.max(0, Math.min(1, y / viewportHeight)),
  };
}
