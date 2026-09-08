// ABOUTME: Identifies live cursor batches that can draw at least one installation trail.
// ABOUTME: Keeps single cursor events from hiding the archive fallback with a blank live field.

import type { CollectionEvent } from "../types";
import { TRAIL_TIME_THRESHOLD } from "./eventUtils";

export function latestDrawableCursorEventId(
  events: readonly CollectionEvent[],
): string | null {
  const groups = new Map<
    string,
    { count: number; newestId: string; earliestTs: number; closed: boolean }
  >();
  const moves = events
    .map((event, index) => ({ event, index }))
    .filter(
      ({ event }) =>
        event.type === "cursor" && event.data.event === "move",
    )
    .sort((a, b) => b.event.ts - a.event.ts || b.index - a.index);

  for (const { event } of moves) {
    const key = `${event.meta.pid}|${event.meta.sid}|${event.meta.url}`;
    const existing = groups.get(key);
    if (existing?.closed) continue;
    if (existing && existing.earliestTs - event.ts > TRAIL_TIME_THRESHOLD) {
      existing.closed = true;
      continue;
    }
    const group = existing ?? {
      count: 0,
      newestId: event.id,
      earliestTs: event.ts,
      closed: false,
    };
    group.count++;
    group.earliestTs = event.ts;
    groups.set(key, group);
    if (group.count >= 2) return group.newestId;
  }
  return null;
}
