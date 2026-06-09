// ABOUTME: Accumulates live cursor events per participant+url so each trail keeps
// ABOUTME: its full point history as the upstream event window slides and trims.

import { useEffect, useMemo, useRef } from "react";
import type { MutableRefObject } from "react";
import type { CollectionEvent } from "../types";

/** A participant+url group's accumulated events plus its last-active time. */
export interface AccumulatedGroup {
  events: CollectionEvent[];
  lastTs: number;
}

export type AccumulatedGroups = Map<string, AccumulatedGroup>;

/** Defensive cap on total accumulated events across all groups. */
const MAX_ACCUMULATED = 8000;

function groupKey(e: CollectionEvent): string {
  return `${e.meta.pid}|${e.meta.url || ""}`;
}

/**
 * Fold a batch of events into the accumulated per-group map (pure).
 *
 * - New events are appended to their group, deduped by event id.
 * - A group's previously-seen events are RETAINED even when the incoming batch
 *   omits them (the upstream window has scrolled past them) — this is the whole
 *   point: a live trail must not lose its leading points.
 * - A group is dropped only when its trail has fully finished on screen
 *   (`evictIds`, reported by the animator) or, as a density backstop, when over
 *   the `maxGroups` cap (oldest-active evicted). There is no time-based
 *   retirement — that would fight accumulation, evicting still-drawn trails.
 *
 * Returns a NEW map (does not mutate the input).
 */
export function accumulateEvents(
  prev: AccumulatedGroups,
  incoming: CollectionEvent[],
  evictIds?: Iterable<string>,
  maxGroups?: number,
): AccumulatedGroups {
  // Clone the prior map shallowly (group objects are replaced when they change).
  const next: AccumulatedGroups = new Map(prev);

  // Drop groups whose trails have finished on screen (events no longer needed).
  if (evictIds) {
    for (const id of evictIds) next.delete(id);
  }

  // Fold incoming events into their groups.
  const touched = new Map<string, Set<string>>();
  for (const e of incoming) {
    const key = groupKey(e);
    const existing = next.get(key);
    const ids =
      touched.get(key) ??
      new Set(existing ? existing.events.map((ev) => ev.id) : []);
    touched.set(key, ids);
    if (ids.has(e.id)) continue;
    ids.add(e.id);
    const events = existing ? existing.events.concat(e) : [e];
    next.set(key, { events, lastTs: Math.max(existing?.lastTs ?? 0, e.ts) });
  }

  // Re-sort only the groups we touched (incoming may arrive out of order).
  for (const key of touched.keys()) {
    const group = next.get(key);
    if (!group) continue;
    const sorted = group.events.slice().sort((a, b) => a.ts - b.ts);
    next.set(key, { events: sorted, lastTs: group.lastTs });
  }

  // Cap to the maxGroups most-recently-active groups, evicting the oldest, so
  // the canvas can't pile up beyond a fixed number of trails on busy data.
  if (maxGroups !== undefined && next.size > maxGroups) {
    const byRecency = Array.from(next.entries()).sort(
      (a, b) => b[1].lastTs - a[1].lastTs,
    );
    for (let i = maxGroups; i < byRecency.length; i++) {
      next.delete(byRecency[i][0]);
    }
  }

  // Total-event backstop: if accumulation still exceeds the budget, evict whole
  // oldest-active groups (never truncate a trail mid-history, which would shrink
  // and re-anchor it). Keeps groupsRef and the flattened output consistent.
  let total = 0;
  for (const group of next.values()) total += group.events.length;
  if (total > MAX_ACCUMULATED && next.size > 1) {
    const byRecency = Array.from(next.entries()).sort(
      (a, b) => b[1].lastTs - a[1].lastTs,
    );
    // Drop from the stalest end until under budget, but always keep one group.
    for (let i = byRecency.length - 1; i > 0 && total > MAX_ACCUMULATED; i--) {
      total -= byRecency[i][1].events.length;
      next.delete(byRecency[i][0]);
    }
  }

  return next;
}

interface UseAccumulatedEventsOptions {
  /** Cap on concurrent participant+url groups; the oldest are evicted past it. */
  maxGroups?: number;
  /**
   * A mutable set of group ids to drop (their trails fully faded out on screen).
   * Drained on each accumulation pass. A ref so the owner can collect ids over
   * time without forcing this hook to re-run.
   */
  evictIdsRef?: MutableRefObject<Set<string>>;
  /** When false, accumulation is bypassed and `events` is returned as-is. */
  enabled?: boolean;
}

/**
 * Keep each live trail's full point history across the sliding event window.
 *
 * `useLiveEvents` caps its event list, so on busy sites a trail's earliest
 * events fall off the front and its derived geometry shrinks / re-anchors /
 * vanishes. This hook accumulates events per participant+url so the downstream
 * trail derivation always sees a live trail's complete history. A group's events
 * are freed only when its trail has fully finished on screen (via `evictIdsRef`,
 * reported by the animator) or when over the `maxGroups` density cap.
 *
 * Returns a flattened, ts-ordered event array suitable for `useCursorTrails`.
 */
export function useAccumulatedEvents(
  events: CollectionEvent[],
  options: UseAccumulatedEventsOptions = {},
): CollectionEvent[] {
  const maxGroups = options.maxGroups;
  const evictIdsRef = options.evictIdsRef;
  const enabled = options.enabled ?? true;
  const groupsRef = useRef<AccumulatedGroups>(new Map());

  const flat = useMemo(() => {
    if (!enabled) return events;

    // Apply any pending evictions reported by the animator. We READ the set here
    // (and clear it in the effect below) rather than clearing it inside the memo:
    // the memo must stay pure so a StrictMode double-invoke doesn't drop the
    // evictions on the second pass. Re-applying the same ids is idempotent
    // (deleting an already-deleted group is a no-op).
    const evict =
      evictIdsRef && evictIdsRef.current.size > 0
        ? evictIdsRef.current
        : undefined;

    groupsRef.current = accumulateEvents(
      groupsRef.current,
      events,
      evict,
      maxGroups,
    );

    // Flatten groups into a single ts-ordered array. The total-event budget is
    // enforced inside accumulateEvents by evicting whole oldest groups, so no
    // mid-trail truncation happens here.
    let result: CollectionEvent[] = [];
    for (const group of groupsRef.current.values()) {
      result = result.concat(group.events);
    }
    result.sort((a, b) => a.ts - b.ts);
    return result;
  }, [events, maxGroups, enabled, evictIdsRef]);

  // Clear the applied evictions after commit (not inside the memo, so a
  // double-invoked memo can't drop them).
  useEffect(() => {
    if (evictIdsRef && evictIdsRef.current.size > 0) {
      evictIdsRef.current = new Set();
    }
  });

  return flat;
}
