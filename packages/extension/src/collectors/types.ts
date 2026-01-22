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
  | 'navigation'
  | 'viewport';

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
 * Cursor event types
 */
export type CursorEventType = 'move' | 'click' | 'hold' | 'cursor_change';

/**
 * Cursor-specific payload (compact format)
 */
export interface CursorEventData {
  x: number;           // 0-1 normalized position
  y: number;           // 0-1 normalized position
  t?: string;          // Target element selector (optional)
  cursor?: string;     // CSS cursor style (pointer, grab, text, etc.)
  event?: CursorEventType;
  button?: number;      // for click/hold: 0=left, 1=middle, 2=right
  duration?: number;   // for hold: ms held
  quantity?: number;   // number of events that occurred during debounce window (for clicks)
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
 * Navigation event types
 */
export type NavigationEventType = 'focus' | 'blur' | 'popstate' | 'beforeunload';

/**
 * Navigation-specific payload
 */
export interface NavigationEventData {
  event: NavigationEventType;
  url?: string;              // for popstate: new URL
  from_url?: string;         // for beforeunload: URL being left
  state?: unknown;           // for popstate: history state
  visibility_state?: string; // for focus/blur: 'visible' or 'hidden'
}

/**
 * Viewport event types
 */
export type ViewportEventType = 'scroll' | 'resize' | 'zoom';

/**
 * Viewport-specific payload
 */
export interface ViewportEventData {
  event: ViewportEventType;
  // For scroll
  scrollX?: number;       // 0-1 normalized (scrollLeft / scrollWidth)
  scrollY?: number;       // 0-1 normalized (scrollTop / scrollHeight)
  // For resize
  width?: number;         // viewport width
  height?: number;        // viewport height
  // For zoom
  zoom?: number;          // current zoom level (e.g., 1.0, 1.25, 1.5)
  previous_zoom?: number; // previous zoom level (for tracking zoom delta)
  // Quantity tracking (for resize and zoom)
  quantity?: number;      // number of events that occurred during debounce window
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
 * Rounds to 4 decimal places for storage efficiency while maintaining sub-pixel accuracy
 * 
 * Precision: 0.0001 ≈ 0.38px on 4K display (3840px), 0.77px on 8K
 * Storage savings: ~6 bytes per event (significant at scale)
 */
export function normalizePosition(
  x: number, 
  y: number, 
  viewportWidth: number, 
  viewportHeight: number
): { x: number; y: number } {
  const normalizedX = x / viewportWidth;
  const normalizedY = y / viewportHeight;
  
  return {
    x: Math.round(Math.max(0, Math.min(1, normalizedX)) * 10000) / 10000,
    y: Math.round(Math.max(0, Math.min(1, normalizedY)) * 10000) / 10000,
  };
}

/**
 * Normalize scroll position to 0-1 range
 * Rounds to 4 decimal places for storage efficiency
 */
export function normalizeScroll(
  scrollLeft: number,
  scrollTop: number,
  scrollWidth: number,
  scrollHeight: number,
  clientWidth: number,
  clientHeight: number
): { scrollX: number; scrollY: number } {
  const maxScrollX = Math.max(0, scrollWidth - clientWidth);
  const maxScrollY = Math.max(0, scrollHeight - clientHeight);

  const normalizedX = maxScrollX > 0 ? scrollLeft / maxScrollX : 0;
  const normalizedY = maxScrollY > 0 ? scrollTop / maxScrollY : 0;

  return {
    scrollX: Math.round(Math.max(0, Math.min(1, normalizedX)) * 10000) / 10000,
    scrollY: Math.round(Math.max(0, Math.min(1, normalizedY)) * 10000) / 10000,
  };
}

/**
 * Get a simple CSS selector for an element
 * Prefers ID, falls back to first class, then tag name
 */
export function getElementSelector(element: HTMLElement): string {
  // Prefer ID
  if (element.id) {
    return `#${element.id}`;
  }

  // Fall back to first class
  if (element.className && typeof element.className === 'string') {
    const classes = element.className.split(' ').filter(Boolean);
    if (classes.length > 0) {
      return `.${classes[0]}`;
    }
  }

  // Fall back to tag name
  return element.tagName.toLowerCase();
}
