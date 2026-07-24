// ABOUTME: Fetches fixed or paginated browsing-event sets from /events/recent.
// ABOUTME: Supports archive playback and installation day/time/viz filters.
import { useCallback, useEffect, useRef, useState } from "react";
import { CollectionEvent, DayCounts } from "../types";
import { deriveRequiredEventTypes } from "../components/registry";
import {
  RECENT_EVENTS_URL,
  DAILY_COUNTS_URL,
  parseTimeOfDayFromUrl,
} from "../config";
import {
  ARCHIVE_BATCH_SIZE,
  advanceArchiveBatchQueue,
  createArchiveEventBatch,
  selectArchiveAnchorType,
  storePrefetchedArchiveBatch,
  type ArchiveBatchQueue,
  type ArchiveEventBatch,
} from "../utils/archiveEventBatches";

const EVENTS_URL = RECENT_EVENTS_URL;
const RETRY_BACKOFFS_MS = [400, 1200];

class NonRetryableFetchError extends Error {}

type TimeOfDay = ReturnType<typeof parseTimeOfDayFromUrl> | null;

/** For a `day` (YYYY-MM-DD) and a recurring time-of-day window (minutes from
 * LOCAL midnight ± radius), return the absolute UTC `from`/`to` ISO bounds that
 * bracket that window. The Date(year, month, day, ...) constructor interprets
 * its args in the viewer's LOCAL timezone, so adding the center/radius minutes
 * and calling toISOString() yields the correct UTC instants — this is how we
 * source "local midnight" footage without the day fetch's recency cap clipping
 * the early-UTC-day midnight events. Pads the window by 1 minute on each side so
 * the client-side ±radius filter has full coverage at the edges. */
function midnightWindowBounds(
  day: string,
  centerMinutes: number,
  radiusMinutes: number,
): { from: string; to: string } {
  const [y, m, d] = day.split("-").map(Number);
  const localMidnight = new Date(y, m - 1, d, 0, 0, 0, 0);
  const pad = 1;
  const startMin = centerMinutes - radiusMinutes - pad;
  const endMin = centerMinutes + radiusMinutes + pad;
  const from = new Date(localMidnight.getTime() + startMin * 60_000);
  const to = new Date(localMidnight.getTime() + endMin * 60_000);
  return { from: from.toISOString(), to: to.toISOString() };
}

async function fetchEventType(
  extraParams: Record<string, string>,
  type: string,
  domain: string,
): Promise<CollectionEvent[]> {
  const params = new URLSearchParams(extraParams);
  if (domain) params.set("domain", domain);
  params.set("type", type);
  const url = `${EVENTS_URL}?${params}`;
  let lastError: unknown;

  for (let attempt = 0; attempt <= RETRY_BACKOFFS_MS.length; attempt++) {
    if (attempt > 0) {
      await new Promise((resolve) =>
        setTimeout(resolve, RETRY_BACKOFFS_MS[attempt - 1]),
      );
    }
    try {
      const response = await fetch(url);
      if (response.ok) return response.json();
      const message = `Failed to fetch ${type} events: ${response.status}`;
      throw response.status >= 500
        ? new Error(message)
        : new NonRetryableFetchError(message);
    } catch (err) {
      if (err instanceof NonRetryableFetchError) throw err;
      lastError = err;
    }
  }

  throw lastError;
}

export interface ArchiveEventsState {
  events: CollectionEvent[];
  loading: boolean;
  error: string | null;
  dayCounts: DayCounts;
  /** Force a full refetch of the current day/tod/viz context. */
  refresh: () => void;
  /** Swap to the prefetched older archive batch when one is ready. */
  advanceBatch: () => boolean;
  /** Stable identity for restarting finite archive playback after a swap. */
  batchKey: string;
}

/** Owns browsing-event fetches for archive surfaces. Fixed mode keeps missing
 * event types populated for installations; batch mode prefetches the next older
 * page and wraps to the newest matching page after history is exhausted. */
export function useArchiveEvents(params: {
  selectedDay: string | null;
  timeOfDay: TimeOfDay;
  serverDomain: string;
  activeVisualizations: string[];
  batchPlayback?: boolean;
}): ArchiveEventsState {
  const {
    selectedDay,
    timeOfDay,
    serverDomain,
    activeVisualizations,
    batchPlayback = false,
  } = params;

  const [events, setEvents] = useState<CollectionEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dayCounts, setDayCounts] = useState<DayCounts>(new Map());
  const [batchQueue, setBatchQueue] = useState<ArchiveBatchQueue>({
    generation: 0,
    current: null,
    prefetched: null,
  });
  const [batchKey, setBatchKey] = useState("fixed");
  const [batchRefreshVersion, setBatchRefreshVersion] = useState(0);
  const batchQueueRef = useRef(batchQueue);
  const batchGenerationRef = useRef(0);
  const batchSequenceRef = useRef(0);
  const prefetchRequestRef = useRef("");

  // Track which event types we've already fetched so we only fetch missing ones
  const fetchedTypesRef = useRef<Set<string>>(new Set());
  // Track the last domain+day combo we fetched for so we know when to force refresh
  const lastFetchKeyRef = useRef<string>("");

  // Fetch daily counts for the heatmap calendar
  useEffect(() => {
    fetch(DAILY_COUNTS_URL)
      .then((r) => {
        if (!r.ok) throw new Error(`Failed to fetch daily counts: ${r.status}`);
        return r.json();
      })
      .then((rows: { day: string; count: number }[]) => {
        const map = new Map<string, number>();
        for (const row of rows) {
          map.set(row.day, row.count);
        }
        setDayCounts(map);
      })
      .catch((err) => {
        console.error("Error fetching daily counts:", err);
      });
  }, []);

  const fetchEvents = useCallback(
    async (
      day: string | null | undefined,
      vizIds: string[],
      domain: string = "",
      forceRefresh = false,
      tod: TimeOfDay = null,
    ) => {
      const requiredTypes = deriveRequiredEventTypes(vizIds);

      if (requiredTypes.size === 0) {
        setLoading(false);
        return;
      }

      // Force refresh when the filter context (day+domain+time-of-day) changed
      const todKey = tod ? `${tod.centerMinutes}:${tod.radiusMinutes}` : "none";
      const fetchKey = `${day ?? "all"}|${domain}|${todKey}`;
      if (fetchKey !== lastFetchKeyRef.current) {
        forceRefresh = true;
        fetchedTypesRef.current = new Set();
        lastFetchKeyRef.current = fetchKey;
      }

      // Determine which types we actually need to fetch
      const typesToFetch = forceRefresh
        ? requiredTypes
        : new Set([...requiredTypes].filter((t) => !fetchedTypesRef.current.has(t)));

      if (typesToFetch.size === 0) {
        setLoading(false);
        return;
      }

      setLoading(true);
      setError(null);

      try {
        // Retry with exponential backoff so a transient network hiccup or a 5xx
        // doesn't leave a window permanently blank. Only network errors and 5xx
        // responses retry (a 4xx is a real request problem — fail fast); the
        // error surfaces only after every attempt is exhausted.
        const fetchOne = async (
          extraParams: Record<string, string>,
          type: string,
        ): Promise<CollectionEvent[]> =>
          fetchEventType(extraParams, type, domain);

        let fetched: CollectionEvent[] = [];
        if (day && tod) {
          // Time-of-day capture (e.g. the "midnight moment"): fetch the tight
          // local time-of-day window directly. A whole-day fetch is recency-
          // capped and returns the END of the UTC day, never reaching early-
          // UTC-day instants like local midnight — so we must bracket the
          // window's exact UTC bounds instead.
          const { from, to } = midnightWindowBounds(
            day,
            tod.centerMinutes,
            tod.radiusMinutes,
          );
          const results = await Promise.all(
            [...typesToFetch].map((type) =>
              fetchOne({ limit: "20000", from, to }, type),
            ),
          );
          fetched = results.flat();
        } else if (day) {
          // Single-day fetch: scope tightly with the original limit.
          const results = await Promise.all(
            [...typesToFetch].map((type) =>
              fetchOne(
                {
                  limit: "5000",
                  from: day,
                  to: `${day}T23:59:59Z`,
                },
                type,
              ),
            ),
          );
          fetched = results.flat();
        } else {
          // No-day fetch: one broad request per type, no date range. The
          // worker returns the 20000 most recent matching events (its hard
          // ceiling), which for typical domains covers months. The earlier
          // 14-day × 800-per-day fan-out introduced a hidden cliff that
          // capped visible history regardless of how much data existed —
          // see the activity strip showing months while the canvas only
          // rendered the most recent two weeks. (The activity strip's
          // per-day counts come from a separate /events/daily-counts
          // endpoint and are not affected by this change.)
          const results = await Promise.all(
            [...typesToFetch].map((type) =>
              fetchOne({ limit: "20000" }, type).catch((err) => {
                console.warn(`Failed to fetch ${type} events:`, err);
                return [] as CollectionEvent[];
              }),
            ),
          );
          fetched = results.flat();
        }

        // Track what we've fetched
        for (const t of typesToFetch) {
          fetchedTypesRef.current.add(t);
        }

        if (forceRefresh) {
          setEvents(fetched);
        } else {
          setEvents((prev) => [...prev, ...fetched]);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to fetch events");
        console.error("Error fetching events:", err);
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  const fetchArchiveBatch = useCallback(
    async (
      beforeMs: number | null,
      day: string | null,
      tod: TimeOfDay,
      domain: string,
      vizIds: string[],
    ): Promise<ArchiveEventBatch> => {
      const requiredTypes = deriveRequiredEventTypes(vizIds);
      if (requiredTypes.size === 0) {
        return createArchiveEventBatch([], [], ARCHIVE_BATCH_SIZE, null);
      }
      const anchorType = selectArchiveAnchorType(requiredTypes);
      const timeOfDayBounds =
        day && tod
          ? midnightWindowBounds(day, tod.centerMinutes, tod.radiusMinutes)
          : null;
      const lowerBound = timeOfDayBounds?.from ?? day;
      const upperBound =
        timeOfDayBounds?.to ?? (day ? `${day}T23:59:59Z` : null);
      const anchorParams: Record<string, string> = {
        limit: String(ARCHIVE_BATCH_SIZE),
      };
      if (lowerBound) anchorParams.from = lowerBound;
      if (beforeMs !== null) {
        anchorParams.to = new Date(beforeMs).toISOString();
      } else if (upperBound) {
        anchorParams.to = upperBound;
      }

      const anchorEvents = await fetchEventType(
        anchorParams,
        anchorType,
        domain,
      );
      if (anchorEvents.length === 0) {
        return createArchiveEventBatch(
          [],
          [],
          ARCHIVE_BATCH_SIZE,
          lowerBound ? new Date(lowerBound).getTime() : null,
        );
      }

      const oldestAnchorMs = Math.min(...anchorEvents.map((event) => event.ts));
      const companionParams: Record<string, string> = {
        limit: "20000",
        from: new Date(oldestAnchorMs).toISOString(),
      };
      if (beforeMs !== null) {
        companionParams.to = new Date(beforeMs).toISOString();
      } else if (upperBound) {
        companionParams.to = upperBound;
      }
      const companionTypes = [...requiredTypes].filter(
        (type) => type !== anchorType,
      );
      const companionEvents = (
        await Promise.all(
          companionTypes.map((type) =>
            fetchEventType(companionParams, type, domain),
          ),
        )
      ).flat();

      return createArchiveEventBatch(
        anchorEvents,
        companionEvents,
        ARCHIVE_BATCH_SIZE,
        lowerBound ? new Date(lowerBound).getTime() : null,
      );
    },
    [],
  );

  // Refetch when the day, server-side domain, time-of-day window, or active
  // visualizations change. time-of-day must refetch because the midnight window
  // is fetched server-side (a tight from/to bracket), not just filtered
  // client-side; active-viz changes fetch any missing event types. A single
  // effect (rather than one per dependency group) so mount fires ONE fetch —
  // two effects both ran on the first render, and the duplicate fetch's late
  // resolution rebuilt the trail set and restarted the animation mid-reveal.
  useEffect(() => {
    if (batchPlayback) return;
    fetchEvents(selectedDay, activeVisualizations, serverDomain, false, timeOfDay);
  }, [
    selectedDay,
    serverDomain,
    timeOfDay,
    activeVisualizations,
    fetchEvents,
    batchPlayback,
  ]);

  useEffect(() => {
    if (!batchPlayback) return;

    const generation = ++batchGenerationRef.current;
    const emptyQueue: ArchiveBatchQueue = {
      generation,
      current: null,
      prefetched: null,
    };
    batchQueueRef.current = emptyQueue;
    batchSequenceRef.current = 0;
    setBatchQueue(emptyQueue);
    prefetchRequestRef.current = "";
    setLoading(true);
    setError(null);

    fetchArchiveBatch(
      null,
      selectedDay,
      timeOfDay,
      serverDomain,
      activeVisualizations,
    )
      .then((batch) => {
        if (generation !== batchGenerationRef.current) return;
        const queue = { ...emptyQueue, current: batch };
        batchQueueRef.current = queue;
        setBatchQueue(queue);
        setEvents(batch.events);
        setBatchKey(`${generation}:0:${batch.key}`);
      })
      .catch((err) => {
        if (generation !== batchGenerationRef.current) return;
        setError(err instanceof Error ? err.message : "Failed to fetch events");
        console.error("Error fetching archive batch:", err);
      })
      .finally(() => {
        if (generation === batchGenerationRef.current) setLoading(false);
      });
  }, [
    batchPlayback,
    selectedDay,
    timeOfDay,
    serverDomain,
    activeVisualizations,
    batchRefreshVersion,
    fetchArchiveBatch,
  ]);

  useEffect(() => {
    if (!batchPlayback || !batchQueue.current || batchQueue.prefetched) return;

    const { current, generation } = batchQueue;
    const requestKey = `${generation}:${current.key}:${current.nextBeforeMs ?? "newest"}`;
    if (prefetchRequestRef.current === requestKey) return;
    prefetchRequestRef.current = requestKey;

    const prefetch = async () => {
      let next = await fetchArchiveBatch(
        current.nextBeforeMs,
        selectedDay,
        timeOfDay,
        serverDomain,
        activeVisualizations,
      );
      if (next.events.length === 0 && current.nextBeforeMs !== null) {
        next = await fetchArchiveBatch(
          null,
          selectedDay,
          timeOfDay,
          serverDomain,
          activeVisualizations,
        );
      }
      if (
        generation !== batchGenerationRef.current ||
        batchQueueRef.current.current?.key !== current.key
      ) {
        return;
      }
      const queue = storePrefetchedArchiveBatch(
        batchQueueRef.current,
        generation,
        next,
      );
      batchQueueRef.current = queue;
      setBatchQueue(queue);
    };

    prefetch().catch((err) => {
      if (generation !== batchGenerationRef.current) return;
      console.warn("Failed to prefetch archive batch:", err);
      prefetchRequestRef.current = "";
    });
  }, [
    batchPlayback,
    batchQueue,
    selectedDay,
    timeOfDay,
    serverDomain,
    activeVisualizations,
    fetchArchiveBatch,
  ]);

  const advanceBatch = useCallback(() => {
    const advanced = advanceArchiveBatchQueue(batchQueueRef.current);
    if (advanced === batchQueueRef.current || !advanced.current) return false;
    batchQueueRef.current = advanced;
    prefetchRequestRef.current = "";
    setBatchQueue(advanced);
    setEvents(advanced.current.events);
    batchSequenceRef.current++;
    setBatchKey(
      `${advanced.generation}:${batchSequenceRef.current}:${advanced.current.key}`,
    );
    return true;
  }, []);

  const refresh = useCallback(() => {
    if (batchPlayback) {
      setBatchRefreshVersion((version) => version + 1);
      return;
    }
    fetchedTypesRef.current = new Set();
    lastFetchKeyRef.current = "";
    fetchEvents(selectedDay, activeVisualizations, serverDomain, true, timeOfDay);
  }, [
    batchPlayback,
    selectedDay,
    serverDomain,
    activeVisualizations,
    timeOfDay,
    fetchEvents,
  ]);

  return {
    events,
    loading,
    error,
    dayCounts,
    refresh,
    advanceBatch,
    batchKey,
  };
}
