// ABOUTME: Restore collection events from the server for a given participant id.
// ABOUTME: Used by the dev-mode "restore from server" button after local data loss.

import type { CollectionEvent, CollectionEventType } from "../collectors/types";
import { getConfig } from "./sync";

const ALL_TYPES: CollectionEventType[] = [
  "cursor",
  "navigation",
  "viewport",
  "keyboard",
];

export interface RestoreProgress {
  /** The event type currently being fetched. */
  type: CollectionEventType;
  /** Total events accumulated so far across all types. */
  total: number;
}

export interface RestoreResult {
  events: CollectionEvent[];
  countsByType: Record<CollectionEventType, number>;
}

/** Per-request page size — the server's hard cap is 5000. */
const PAGE_SIZE = 5000;

/**
 * Fetch a date range of events for one type, paginating until exhausted.
 * The server returns newest-first; we page backwards using `to` as cursor.
 */
async function fetchTypeRange(
  workerUrl: string,
  pid: string,
  type: CollectionEventType,
  from?: string,
  to?: string,
): Promise<CollectionEvent[]> {
  const results: CollectionEvent[] = [];
  let toParam = to;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const params = new URLSearchParams({
      type,
      pid,
      limit: PAGE_SIZE.toString(),
    });
    if (from) params.set("from", from);
    if (toParam) params.set("to", toParam);

    const res = await fetch(`${workerUrl}/events/recent?${params}`);
    if (!res.ok) {
      throw new Error(
        `Server returned ${res.status} fetching ${type}: ${await res
          .text()
          .catch(() => "")}`,
      );
    }
    const batch = (await res.json()) as CollectionEvent[];
    results.push(...batch);

    console.log(
      `[Restore] ${type}: +${batch.length} (${results.length} for type)`,
    );

    if (batch.length < PAGE_SIZE) break;

    // Cursor: oldest event's ts minus 1ms to avoid re-fetching the boundary
    const oldestTs = batch[batch.length - 1].ts;
    toParam = new Date(oldestTs - 1).toISOString();
  }

  return results;
}

/**
 * Fetch events for `pid` from the server, across all event types.
 *
 * When `localBounds` is provided (oldest/newest local event timestamps),
 * only fetches events outside that window — i.e. events older than the
 * oldest local event and events newer than the newest local event. This
 * avoids re-fetching the bulk of data you already have locally.
 *
 * Events are deduplicated at write time by `store.addEvents()` (IDB put by id),
 * so boundary overlap is harmless.
 */
export async function fetchEventsByPid(
  pid: string,
  options: {
    types?: CollectionEventType[];
    localBounds?: { oldest: number; newest: number };
    onProgress?: (p: RestoreProgress) => void;
  } = {},
): Promise<RestoreResult> {
  const { types = ALL_TYPES, localBounds, onProgress } = options;
  const { workerUrl } = await getConfig();

  const events: CollectionEvent[] = [];
  const countsByType: Record<CollectionEventType, number> = {
    cursor: 0,
    navigation: 0,
    viewport: 0,
    keyboard: 0,
    element: 0,
  };

  for (const type of types) {
    let typeEvents: CollectionEvent[] = [];

    if (localBounds && localBounds.oldest > 0 && localBounds.newest > 0) {
      // Fetch older events (before our local window)
      const olderBatch = await fetchTypeRange(
        workerUrl,
        pid,
        type,
        undefined,
        new Date(localBounds.oldest - 1).toISOString(),
      );
      typeEvents.push(...olderBatch);
      console.log(
        `[Restore] ${type}: ${olderBatch.length} older events (before ${new Date(localBounds.oldest).toISOString()})`,
      );

      // Fetch newer events (after our local window)
      const newerBatch = await fetchTypeRange(
        workerUrl,
        pid,
        type,
        new Date(localBounds.newest + 1).toISOString(),
        undefined,
      );
      typeEvents.push(...newerBatch);
      console.log(
        `[Restore] ${type}: ${newerBatch.length} newer events (after ${new Date(localBounds.newest).toISOString()})`,
      );
    } else {
      // No local data — fetch everything
      typeEvents = await fetchTypeRange(workerUrl, pid, type);
    }

    countsByType[type] = typeEvents.length;
    events.push(...typeEvents);
    onProgress?.({ type, total: events.length });
  }

  console.log(`[Restore] Total: ${events.length} events to import`);
  return { events, countsByType };
}
