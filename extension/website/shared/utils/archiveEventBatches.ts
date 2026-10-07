// ABOUTME: Plans finite archive event batches and their older-page boundaries.
// ABOUTME: Keeps archive pagination and stale-prefetch handling deterministic.

import type { CollectionEvent } from "../types";

export const ARCHIVE_BATCH_SIZE = 1000;

export interface ArchiveEventBatch {
  events: CollectionEvent[];
  nextBeforeMs: number | null;
  key: string;
}

export interface ArchiveBatchQueue {
  generation: number;
  current: ArchiveEventBatch | null;
  prefetched: ArchiveEventBatch | null;
}

export function selectArchiveAnchorType(requiredTypes: Set<string>): string {
  if (requiredTypes.has("cursor")) return "cursor";
  const firstType = requiredTypes.values().next().value;
  if (!firstType) throw new Error("Archive playback requires an event type");
  return firstType;
}

export function createArchiveEventBatch(
  anchorEvents: CollectionEvent[],
  companionEvents: CollectionEvent[],
  batchSize: number,
  lowerBoundMs: number | null,
): ArchiveEventBatch {
  if (anchorEvents.length === 0) {
    return { events: [], nextBeforeMs: null, key: "empty" };
  }

  const oldestAnchorMs = Math.min(...anchorEvents.map((event) => event.ts));
  const nextBeforeMs =
    anchorEvents.length < batchSize ||
    (lowerBoundMs !== null && oldestAnchorMs <= lowerBoundMs)
      ? null
      : oldestAnchorMs - 1;
  const events = [...anchorEvents, ...companionEvents].sort(
    (a, b) => b.ts - a.ts,
  );

  return {
    events,
    nextBeforeMs,
    key: `${events[0].ts}:${oldestAnchorMs}:${events.length}`,
  };
}

export function storePrefetchedArchiveBatch(
  queue: ArchiveBatchQueue,
  generation: number,
  batch: ArchiveEventBatch,
): ArchiveBatchQueue {
  if (generation !== queue.generation) return queue;
  return { ...queue, prefetched: batch };
}

export function advanceArchiveBatchQueue(
  queue: ArchiveBatchQueue,
): ArchiveBatchQueue {
  if (!queue.prefetched) return queue;
  return { ...queue, current: queue.prefetched, prefetched: null };
}
