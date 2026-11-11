// ABOUTME: Uploads collected browsing events to the Cloudflare Worker for storage.
// ABOUTME: Strips URL fragments from outgoing payloads and drops batches the worker permanently rejects.

import { WORKER_URL } from '@movement/config';
import type { CollectionEvent, NavigationEventData } from '../collectors/types';
import { VERBOSE } from '../config';
import { stripFragment } from '../utils/urlNormalization';

/**
 * Hash fragments can carry sensitive content (OAuth tokens, in-page state)
 * regardless of event type. Strip them from the outgoing payload only; the
 * local IndexedDB copy (used for the user's own history/visualization
 * features) keeps the full URL. Query strings are kept because they often
 * identify the page (e.g. YouTube's `v`).
 */
function sanitizeForUpload(events: CollectionEvent[]): CollectionEvent[] {
  return events.map((event) => {
    let sanitized = event;
    if (event.meta?.url) {
      sanitized = { ...sanitized, meta: { ...event.meta, url: stripFragment(event.meta.url) } };
    }
    // Navigation events also carry window.location.href in their payload:
    // data.url on popstate and data.from_url on beforeunload.
    if (event.type === 'navigation') {
      const data = event.data as NavigationEventData;
      if (typeof data.url === 'string' || typeof data.from_url === 'string') {
        const cleaned: NavigationEventData = { ...data };
        if (typeof data.url === 'string') cleaned.url = stripFragment(data.url);
        if (typeof data.from_url === 'string') cleaned.from_url = stripFragment(data.from_url);
        sanitized = { ...sanitized, data: cleaned } as CollectionEvent;
      }
    }
    return sanitized;
  });
}

/**
 * Upload events to Cloudflare Worker API
 * 
 * The ingest endpoint is public (no auth required) because:
 * - Extension code is client-side, so any API key would be visible
 * - The worker validates event structure and applies rate limits
 * - The data is anonymous cursor movements (low abuse risk)
 */
export async function uploadEvents(events: CollectionEvent[]): Promise<void> {
  if (events.length === 0) {
    return;
  }

  const sanitizedEvents = sanitizeForUpload(events);

  let response: Response;
  try {
    response = await fetch(`${WORKER_URL}/events`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ events: sanitizedEvents }),
    });
  } catch (error) {
    console.error('[Sync] Failed to reach worker at', WORKER_URL, ':', error);
    // Rethrown so the caller keeps the events pending and retries later.
    // The server may still have inserted them; its upsert ignores duplicates.
    throw error;
  }

  if (!response.ok) {
    const errorText = await response.text();
    if (isRejectedBatch(response.status, errorText)) {
      // The worker will never accept this batch, so retrying only repeats
      // the failure. Returning lets the caller settle it: the events stay in
      // local history and are not sent again.
      console.warn(
        `[Sync] Worker rejected ${events.length} events (${response.status}); keeping them local only:`,
        errorText,
      );
      return;
    }
    throw new Error(`Upload failed: ${response.status} ${errorText}`);
  }

  const result = await response.json();
  const inserted = result.inserted || 0;
  const duplicates = result.duplicates || 0;

  if (VERBOSE) {
    if (duplicates > 0) {
      console.log(`[Sync] Uploaded ${inserted} new events, ${duplicates} duplicates (already existed)`);
    } else {
      console.log(`[Sync] Uploaded ${inserted} events`);
    }
  }
}

/** 4xx statuses that can succeed on a later attempt without changing the batch. */
const RETRYABLE_CLIENT_STATUSES = new Set([401, 403, 408, 429]);

/**
 * Whether the worker refused the batch itself. Other 4xx responses mean the
 * events are malformed. A Postgres "index row size exceeds" error means a
 * value is too large to index; it arrives as a server error from workers
 * that predate malformed-event validation.
 */
function isRejectedBatch(status: number, errorText: string): boolean {
  if (status >= 400 && status < 500) {
    return !RETRYABLE_CLIENT_STATUSES.has(status);
  }
  return errorText.includes('index row size') && errorText.includes('exceeds');
}

/**
 * Get current configuration
 */
export async function getConfig(): Promise<{ workerUrl: string }> {
  return { workerUrl: WORKER_URL };
}
