/**
 * Shared types between extension and worker
 * 
 * These types define the core event structure that both the extension
 * (which collects events) and the worker (which validates and stores events)
 * need to agree on.
 */

/**
 * Event types that can be collected
 */
export type CollectionEventType = 
  | 'cursor' 
  | 'navigation'
  | 'viewport'
  | 'keyboard';

/**
 * Get array of valid event types (for validation)
 */
export function getValidEventTypes(): CollectionEventType[] {
  return ['cursor', 'navigation', 'viewport', 'keyboard'];
}

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
 * Base event structure - all collectors emit this
 */
export interface CollectionEvent {
  id: string;                    // ULID (sortable, unique)
  type: CollectionEventType;     // Event type
  ts: number;                    // Unix ms timestamp
  data: unknown;                 // Type-specific payload
  meta: EventMeta;
}
