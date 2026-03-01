// ABOUTME: Loads historical event data for domain visualization
// ABOUTME: Combines local IndexedDB data (via background worker) with server backfill as needed

import browser from 'webextension-polyfill';
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

  if (VERBOSE) console.log(`[HistoryLoader] Loading data in ${actualMode} mode`);
  if (VERBOSE) console.log(`[HistoryLoader] Domain: ${domain}, URL: ${normalizedCurrentUrl}`);

  const allEvents: CollectionEvent[] = [];

  // Query background service worker for each event type
  for (const type of types) {
    let localEvents: CollectionEvent[] = [];
    try {
      if (actualMode === 'domain') {
        const res: any = await browser.runtime.sendMessage({
          type: 'QUERY_EVENTS_BY_DOMAIN',
          domain,
          options: { type, limit },
        });
        localEvents = res?.events || [];
      } else {
        const res: any = await browser.runtime.sendMessage({
          type: 'QUERY_EVENTS_BY_URL',
          url: normalizedCurrentUrl,
          options: { type, limit },
        });
        localEvents = res?.events || [];
      }
    } catch (e) {
      console.error(`[HistoryLoader] Failed to query ${type} from background:`, e);
    }

    if (VERBOSE) console.log(
      `[HistoryLoader] Found ${localEvents.length} local ${type} events`,
    );

    allEvents.push(...localEvents);
  }

  if (VERBOSE) console.log(`[HistoryLoader] Total local events: ${allEvents.length}`);

  // Only fetch from server if explicitly forced (via obscure keyboard shortcut)
  if (!forceServerBackfill) {
    if (VERBOSE) console.log(
      `[HistoryLoader] Using ${allEvents.length} local events`,
    );
    return sortEventsByTimestamp(allEvents);
  }

  // Forced server backfill (Ctrl+Shift+Alt+H)
  if (VERBOSE) console.log(
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

    if (VERBOSE) console.log(
      `[HistoryLoader] Fetched ${serverEvents.length} events from server`,
    );

    // Combine and deduplicate
    const combined = deduplicateEvents([...allEvents, ...serverEvents]);

    if (VERBOSE) console.log(
      `[HistoryLoader] Final combined events: ${combined.length}`,
    );

    return sortEventsByTimestamp(combined);
  } catch (error) {
    console.error("[HistoryLoader] Failed to fetch from server:", error);
    // Return local data if server fetch failed
    if (VERBOSE) console.log(
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
        if (VERBOSE) console.log(
          `[HistoryLoader] Filtered ${type} events to URL: ${events.length} remaining`,
        );
      }

      allEvents.push(...events);

      if (VERBOSE) console.log(
        `[HistoryLoader] Fetched ${events.length} ${type} events from server`,
      );
    } catch (error) {
      console.error(
        `[HistoryLoader] Error fetching ${type} from server:`,
        error,
      );
    }
  }

  if (VERBOSE) console.log(
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
