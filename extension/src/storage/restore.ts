// ABOUTME: Restore collection events from the server for a given participant id.
// ABOUTME: Used by the dev-mode "restore from server" button after local data loss.

import type { CollectionEvent, CollectionEventType } from "../collectors/types";
import { getConfig } from "./sync";
import { VERBOSE } from "../config";

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

/**
 * Fetch every event for `pid` from the server, across all event types.
 *
 * Caps at `limit` per type (the server's hard cap is 5000 per call). For a
 * first pass this is sufficient — cursor events dominate, and 5000 rows is
 * roughly the density of an active week. If it's ever short, we can page.
 */
export async function fetchEventsByPid(
  pid: string,
  options: {
    limit?: number;
    types?: CollectionEventType[];
    onProgress?: (p: RestoreProgress) => void;
  } = {},
): Promise<RestoreResult> {
  const { limit = 5000, types = ALL_TYPES, onProgress } = options;
  const { workerUrl } = await getConfig();

  const events: CollectionEvent[] = [];
  const countsByType: Record<CollectionEventType, number> = {
    cursor: 0,
    navigation: 0,
    viewport: 0,
    keyboard: 0,
  };

  for (const type of types) {
    const params = new URLSearchParams({
      type,
      pid,
      limit: limit.toString(),
    });
    const res = await fetch(`${workerUrl}/events/recent?${params}`);
    if (!res.ok) {
      throw new Error(
        `Server returned ${res.status} fetching ${type} events: ${await res
          .text()
          .catch(() => "")}`,
      );
    }
    const batch = (await res.json()) as CollectionEvent[];
    countsByType[type] = batch.length;
    events.push(...batch);
    if (VERBOSE) {
      console.log(`[Restore] Fetched ${batch.length} ${type} events`);
    }
    onProgress?.({ type, total: events.length });
  }

  return { events, countsByType };
}
