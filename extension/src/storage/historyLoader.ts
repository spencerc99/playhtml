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
  stripFragment,
} from "../utils/urlNormalization";
import { isExtensionPageUrl } from "../utils/extensionPage";
import { MissingIdentityError, signedReadHeaders } from "./signedRead";
import {
  MAX_PAGE_EVENT_URL_LENGTH,
  formatUrlHashes,
  pageEventUrlVariants,
} from "../utils/pageEventUrls";
import { md5Hex } from "../utils/md5";

/** Background message that fetches one type of shared events from the Worker. */
export const FETCH_SERVER_EVENTS_MESSAGE = 'FETCH_SERVER_EVENTS';

/**
 * One type of shared events for a whole site (`domain`) or for one page
 * (`urlHashes`: md5 hashes of the page's stored URL forms, which the Worker
 * reads through its page index without ever seeing the URL).
 */
export type ServerEventsRequest = {
  type: CollectionEventType;
  limit: number;
} & (
  | { domain: string; urlHashes?: undefined }
  | { urlHashes: string[]; domain?: undefined }
);

/**
 * md5 hashes of the stored URL forms of `pageUrl` (see pageEventUrlVariants).
 * A URL too long for a page lookup is looked up without its query string, so
 * a page reached through a very long link still shows the trails left on its
 * plain address. Throws for a page that is not http(s).
 */
export function pageUrlHashes(pageUrl: string): string[] {
  let variants: string[];
  try {
    let url = stripFragment(pageUrl);
    if (url.length > MAX_PAGE_EVENT_URL_LENGTH) {
      const withoutQuery = new URL(url);
      withoutQuery.search = "";
      url = withoutQuery.toString();
    }
    variants = pageEventUrlVariants(url);
  } catch {
    throw new Error("Could not load shared trails for this page");
  }
  return variants.map(md5Hex);
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
      currentUrl,
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
    currentUrl,
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
 *
 * In 'url' mode only md5 hashes of this page's stored URL forms leave the
 * browser (the page URL without its fragment, without its query string, and
 * with the trailing slash toggled), and the Worker reads only events stored
 * under them. The normalized-URL filter then drops anything that does not match
 * the local definition of the page, including another page that shares an md5;
 * the Worker never returns events for other query strings of the same path,
 * which the normalized comparison would keep.
 *
 * On a web page the request goes through the background: a content script's
 * fetch carries the page's Origin, which the Worker's origin allowlist
 * refuses. Each type is its own message, which keeps every reply well under
 * the runtime message size limit.
 */
async function fetchServerEvents(
  domain: string,
  currentUrl: string,
  mode: 'domain' | 'url',
  limit: number,
  types: CollectionEventType[],
): Promise<CollectionEvent[]> {
  const viaBackground = !isExtensionPageUrl(window.location.href);
  const normalizedUrl = normalizeUrl(currentUrl);
  const urlHashes = mode === 'url' ? pageUrlHashes(currentUrl) : null;
  const allEvents: CollectionEvent[] = [];

  for (const type of types) {
    const request: ServerEventsRequest =
      urlHashes !== null ? { urlHashes, type, limit } : { domain, type, limit };
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
    ...(request.urlHashes !== undefined
      ? { urlHashes: request.urlHashes }
      : { domain: request.domain }),
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
 * Read one type of recent shared events for a domain or one page from the
 * Worker's `/events/recent`. The request is signed with the stored identity
 * key, because the background and extension pages send no Origin for the
 * Worker to check; without a stored identity nothing is sent. Throws with a
 * message fit for the overlay when the request cannot be made, fails, or the
 * Worker answers with an error status.
 */
export async function fetchRecentServerEvents(
  request: ServerEventsRequest,
): Promise<CollectionEvent[]> {
  const { type, limit } = request;
  const params = new URLSearchParams({
    type,
    limit: limit.toString(),
    ...(request.urlHashes !== undefined
      ? { urlHash: formatUrlHashes(request.urlHashes) }
      : { domain: request.domain }),
  });

  let headers: Record<string, string>;
  try {
    headers = await signedReadHeaders();
  } catch (error) {
    if (error instanceof MissingIdentityError) {
      throw new Error('Could not load shared trails: this browser has no identity yet');
    }
    throw error;
  }

  let response: Response;
  try {
    response = await fetch(`${WORKER_URL}/events/recent?${params.toString()}`, {
      headers,
    });
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
