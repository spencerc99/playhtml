// ABOUTME: Fetches and merges browsing events for multiple participants by PID.
// ABOUTME: Fans out one request per (pid, eventType) to the worker, then concatenates.

import type { CollectionEvent } from "@movement/types";
import { RECENT_EVENTS_URL } from "@movement/config";
import { deriveRequiredEventTypes } from "@movement/components/registry";

const PER_PID_LIMIT = 5000;

/**
 * Fetch events for each participant PID and merge them into one array.
 *
 * One request per (pid, eventType): the worker's /events/recent filters by a
 * single `pid`, so multiple participants require fan-out. A failed request for
 * one pid contributes nothing rather than failing the whole portrait.
 */
export async function fetchPortraitEvents(
  pids: string[],
  vizIds: string[],
): Promise<CollectionEvent[]> {
  if (pids.length === 0) return [];

  const types = [...deriveRequiredEventTypes(vizIds)];
  if (types.length === 0) return [];

  const requests: Promise<CollectionEvent[]>[] = [];
  for (const pid of pids) {
    for (const type of types) {
      const params = new URLSearchParams({
        pid,
        type,
        limit: String(PER_PID_LIMIT),
      });
      requests.push(
        fetch(`${RECENT_EVENTS_URL}?${params}`)
          .then((r) => {
            if (!r.ok)
              throw new Error(`fetch failed for ${pid}/${type}: ${r.status}`);
            return r.json() as Promise<CollectionEvent[]>;
          })
          .catch((err) => {
            console.warn(`[walking-together] portrait fetch failed`, err);
            return [] as CollectionEvent[];
          }),
      );
    }
  }

  const results = await Promise.all(requests);
  return results.flat();
}
