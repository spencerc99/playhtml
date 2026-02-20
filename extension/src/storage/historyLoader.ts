// ABOUTME: Loads historical event data for domain visualization
// ABOUTME: Combines local IndexedDB data with server backfill as needed

import { LocalEventStore } from "./LocalEventStore";
import type { CollectionEvent, CollectionEventType } from "../collectors/types";
import { getConfig } from "./sync";
import { VERBOSE } from "../config";
import {
  normalizeUrl,
  extractDomain,
  determineFilterScope,
} from "../utils/urlNormalization";

export interface LoadOptions {
  limit?: number;
  types?: CollectionEventType[];
  forceServerBackfill?: boolean;
}

export type FilterMode = 'domain' | 'url' | 'auto';

/**
 * Load historical events with smart filtering
 * Supports domain-wide or URL-specific filtering
 *
 * @param currentUrl - Current page URL
 * @param mode - Filter mode: 'domain' (all pages), 'url' (this page), 'auto' (smart detect)
 * @param options - Additional query options
 */
export async function loadHistoricalData(
  currentUrl: string,
  mode: FilterMode = 'auto',
  options: LoadOptions = {},
): Promise<CollectionEvent[]> {
  const { limit = 1000, types = ["cursor", "keyboard", "viewport", "navigation"], forceServerBackfill = false } = options;

  // Determine filter scope
  const scope = determineFilterScope(currentUrl);
  const actualMode = mode === 'auto' ? scope.mode : mode;
  const domain = extractDomain(currentUrl);
  const normalizedCurrentUrl = normalizeUrl(currentUrl);

  console.log(`[HistoryLoader] Loading data in ${actualMode} mode`);
  console.log(`[HistoryLoader] Domain: ${domain}, URL: ${normalizedCurrentUrl}`);

  const localStore = new LocalEventStore();
  const allEvents: CollectionEvent[] = [];

  // Query local storage for each event type
  for (const type of types) {
    const localEvents = actualMode === 'domain'
      ? await localStore.queryByDomain(domain, { type, limit })
      : await localStore.queryByUrl(normalizedCurrentUrl, { type, limit });

    console.log(
      `[HistoryLoader] Found ${localEvents.length} local ${type} events`,
    );

    allEvents.push(...localEvents);
  }

  console.log(`[HistoryLoader] Total local events: ${allEvents.length}`);

  // Only fetch from server if explicitly forced (via obscure keyboard shortcut)
  if (!forceServerBackfill) {
    console.log(
      `[HistoryLoader] Using ${allEvents.length} local events`,
    );
    return sortEventsByTimestamp(allEvents);
  }

  // Forced server backfill (Ctrl+Shift+Alt+H)
  console.log(
    `[HistoryLoader] Forcing server backfill (local: ${allEvents.length})`,
  );

  try {
    const serverEvents = await fetchServerEvents(
      domain,
      normalizedCurrentUrl,
      actualMode,
      limit,
      types
    );

    console.log(
      `[HistoryLoader] Fetched ${serverEvents.length} events from server`,
    );

    // Combine and deduplicate
    const combined = deduplicateEvents([...allEvents, ...serverEvents]);

    console.log(
      `[HistoryLoader] Final combined events: ${combined.length}`,
    );

    return sortEventsByTimestamp(combined);
  } catch (error) {
    console.error("[HistoryLoader] Failed to fetch from server:", error);
    // Return local data if server fetch failed
    console.log(
      `[HistoryLoader] Returning ${allEvents.length} local events (server fetch failed)`,
    );
    return sortEventsByTimestamp(allEvents);
  }
}

/**
 * Fetch events from server
 * Client-side filters by normalized URL if mode is 'url'
 */
async function fetchServerEvents(
  domain: string,
  normalizedUrl: string,
  mode: 'domain' | 'url',
  limit: number,
  types: CollectionEventType[],
): Promise<CollectionEvent[]> {
  const { workerUrl } = await getConfig();
  const allEvents: CollectionEvent[] = [];

  // Fetch each event type
  for (const type of types) {
    try {
      const params = new URLSearchParams({
        type,
        limit: limit.toString(),
        domain,
      });

      const response = await fetch(
        `${workerUrl}/events/recent?${params.toString()}`,
      );

      if (!response.ok) {
        console.error(
          `[HistoryLoader] Server fetch failed for ${type}: ${response.status}`,
        );
        continue;
      }

      let events = await response.json();

      // Filter to normalized URL if in URL mode (client-side filtering)
      if (mode === 'url') {
        events = events.filter((e: CollectionEvent) => {
          const eventNormalizedUrl = normalizeUrl(e.meta.url);
          return eventNormalizedUrl === normalizedUrl;
        });
        console.log(
          `[HistoryLoader] Filtered ${type} events to URL: ${events.length} remaining`,
        );
      }

      allEvents.push(...events);

      console.log(
        `[HistoryLoader] Fetched ${events.length} ${type} events from server`,
      );
    } catch (error) {
      console.error(
        `[HistoryLoader] Error fetching ${type} from server:`,
        error,
      );
    }
  }

  console.log(
    `[HistoryLoader] Total server events fetched: ${allEvents.length}`,
  );
  return allEvents;
}

/**
 * Deduplicate events by ID
 */
function deduplicateEvents(events: CollectionEvent[]): CollectionEvent[] {
  const seen = new Set<string>();
  const unique: CollectionEvent[] = [];

  for (const event of events) {
    if (!seen.has(event.id)) {
      seen.add(event.id);
      unique.push(event);
    }
  }

  return unique;
}

/**
 * Sort events by timestamp (ascending - oldest first for chronological playback)
 */
function sortEventsByTimestamp(events: CollectionEvent[]): CollectionEvent[] {
  return events.sort((a, b) => a.ts - b.ts);
}

/**
 * Get current page domain
 */
export function getCurrentDomain(): string {
  return extractDomain(window.location.href);
}
