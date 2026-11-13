// ABOUTME: Loads historical event data for domain visualization
// ABOUTME: Combines local IndexedDB data with the Worker's shared events, fetched via the background on web pages

import browser from 'webextension-polyfill';
import type { CollectionEvent, CollectionEventType } from "../collectors/types";
import { WORKER_URL } from "@movement/config";
import { VERBOSE } from "../config";
import {
  normalizeUrl,
  extractDomain,
  determineFilterScope,
} from "../utils/urlNormalization";
import { isExtensionPageUrl } from "../utils/extensionPage";

/** Background message that fetches one type of shared events from the Worker. */
export const FETCH_SERVER_EVENTS_MESSAGE = 'FETCH_SERVER_EVENTS';

export interface ServerEventsRequest {
  domain: string;
  type: CollectionEventType;
  limit: number;
}

export type ServerEventsResponse =
  | { ok: true; events: CollectionEvent[] }
  | { ok: false; error: string };

export interface LoadOptions {
  limit?: number;
  types?: CollectionEventType[];
  forceServerBackfill?: boolean;
  /**
   * Whose trails to load. 'mine' reads this browser's local history;
   * 'everyone' reads every participant's shared events from the server.
   */
  source?: TrailSource;
}

export type TrailSource = 'mine' | 'everyone';

/** Server events to request per type when showing everyone's trails. */
export const EVERYONE_TRAILS_LIMIT = 5000;

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
  const {
    limit = 1000,
    types = ["cursor", "keyboard", "viewport", "navigation"],
    forceServerBackfill = false,
    source = 'mine',
  } = options;

  // Determine filter scope
  const scope = determineFilterScope(currentUrl);
  const actualMode = mode === 'auto' ? scope.mode : mode;
  const domain = extractDomain(currentUrl);
  const normalizedCurrentUrl = normalizeUrl(currentUrl);

  if (VERBOSE) console.log(`[HistoryLoader] Loading data in ${actualMode} mode`);
  if (VERBOSE) console.log(`[HistoryLoader] Domain: ${domain}, URL: ${normalizedCurrentUrl}`);

  if (source === 'everyone') {
    const serverEvents = await fetchServerEvents(
      domain,
      normalizedCurrentUrl,
      actualMode,
      limit,
      types,
    );
    return sortEventsByTimestamp(deduplicateEvents(serverEvents));
  }

  const allEvents: CollectionEvent[] = [];

  const eventGroups = await Promise.all(
    types.map(async (type): Promise<CollectionEvent[]> => {
      try {
        if (actualMode === 'domain') {
          const res: any = await browser.runtime.sendMessage({
            type: 'QUERY_EVENTS_BY_DOMAIN',
            domain,
            options: { type, limit },
          });
          const localEvents = res?.events || [];
          if (VERBOSE) console.log(
            `[HistoryLoader] Found ${localEvents.length} local ${type} events`,
          );
          return localEvents;
        } else {
          const res: any = await browser.runtime.sendMessage({
            type: 'QUERY_EVENTS_BY_URL',
            url: normalizedCurrentUrl,
            options: { type, limit },
          });
          const localEvents = res?.events || [];
          if (VERBOSE) console.log(
            `[HistoryLoader] Found ${localEvents.length} local ${type} events`,
          );
          return localEvents;
        }
      } catch (e) {
        console.error(`[HistoryLoader] Failed to query ${type} from background:`, e);
        return [];
      }
    }),
  );

  for (const localEvents of eventGroups) {
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

  // A failed server read throws so the overlay shows the error instead of
  // presenting local events as if the backfill had succeeded.
  const serverEvents = await fetchServerEvents(
    domain,
    normalizedCurrentUrl,
    actualMode,
    limit,
    types,
  );

  if (VERBOSE) console.log(
    `[HistoryLoader] Fetched ${serverEvents.length} events from server`,
  );

  const combined = deduplicateEvents([...allEvents, ...serverEvents]);

  if (VERBOSE) console.log(
    `[HistoryLoader] Final combined events: ${combined.length}`,
  );

  return sortEventsByTimestamp(combined);
}

/**
 * Fetch shared events from the Worker, one request per type.
 * Client-side filters by normalized URL if mode is 'url'.
 *
 * On a web page the request goes through the background: a content script's
 * fetch carries the page's Origin, which the Worker's origin allowlist
 * refuses. Each type is its own message, which keeps every reply well under
 * the runtime message size limit.
 */
async function fetchServerEvents(
  domain: string,
  normalizedUrl: string,
  mode: 'domain' | 'url',
  limit: number,
  types: CollectionEventType[],
): Promise<CollectionEvent[]> {
  const viaBackground = !isExtensionPageUrl(window.location.href);
  const allEvents: CollectionEvent[] = [];

  for (const type of types) {
    const request: ServerEventsRequest = { domain, type, limit };
    let events = viaBackground
      ? await requestServerEventsFromBackground(request)
      : await fetchRecentServerEvents(request);

    if (mode === 'url') {
      events = events.filter(
        (e) => normalizeUrl(e.meta.url) === normalizedUrl,
      );
      if (VERBOSE) console.log(
        `[HistoryLoader] Filtered ${type} events to URL: ${events.length} remaining`,
      );
    }

    allEvents.push(...events);

    if (VERBOSE) console.log(
      `[HistoryLoader] Fetched ${events.length} ${type} events from server`,
    );
  }

  if (VERBOSE) console.log(
    `[HistoryLoader] Total server events fetched: ${allEvents.length}`,
  );
  return allEvents;
}

async function requestServerEventsFromBackground(
  request: ServerEventsRequest,
): Promise<CollectionEvent[]> {
  const response = (await browser.runtime.sendMessage({
    type: FETCH_SERVER_EVENTS_MESSAGE,
    domain: request.domain,
    eventType: request.type,
    limit: request.limit,
  })) as ServerEventsResponse | undefined;
  if (!response) {
    throw new Error('Could not load shared trails: no reply from the extension');
  }
  if (!response.ok) throw new Error(response.error);
  return response.events;
}

/**
 * Read one type of recent shared events for a domain from the Worker's
 * `/events/recent`. Throws with a message fit for the overlay when the
 * request fails or the Worker answers with an error status.
 */
export async function fetchRecentServerEvents({
  domain,
  type,
  limit,
}: ServerEventsRequest): Promise<CollectionEvent[]> {
  const params = new URLSearchParams({
    type,
    limit: limit.toString(),
    domain,
  });

  let response: Response;
  try {
    response = await fetch(`${WORKER_URL}/events/recent?${params.toString()}`);
  } catch (error) {
    console.error(`[HistoryLoader] Server fetch failed for ${type}:`, error);
    throw new Error('Could not reach the server for shared trails');
  }

  if (!response.ok) {
    console.error(
      `[HistoryLoader] Server fetch failed for ${type}: ${response.status}`,
    );
    throw new Error(`Could not load shared trails (server error ${response.status})`);
  }

  const events: unknown = await response.json();
  if (!Array.isArray(events)) {
    throw new Error('Could not load shared trails: unexpected server response');
  }
  return events as CollectionEvent[];
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
