// ABOUTME: Fetches archived browsing events from /events/recent for the archive
// ABOUTME: and installation pages, keyed by day + time-of-day + active viz.
import { useCallback, useEffect, useRef, useState } from "react";
import { CollectionEvent, DayCounts } from "../types";
import { deriveRequiredEventTypes } from "../components/registry";
import {
  RECENT_EVENTS_URL,
  DAILY_COUNTS_URL,
  parseTimeOfDayFromUrl,
} from "../config";

const EVENTS_URL = RECENT_EVENTS_URL;

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

export interface ArchiveEventsState {
  events: CollectionEvent[];
  loading: boolean;
  error: string | null;
  dayCounts: DayCounts;
  /** Force a full refetch of the current day/tod/viz context. */
  refresh: () => void;
}

/** Owns the archive event fetch. Given the current day, time-of-day window,
 * server-side domain, and active visualizations, keeps `events` populated and
 * fetches only the event types that are missing. Extracted from the archive
 * page so the installation page shares the exact same fetch behavior. */
export function useArchiveEvents(params: {
  selectedDay: string | null;
  timeOfDay: TimeOfDay;
  serverDomain: string;
  activeVisualizations: string[];
}): ArchiveEventsState {
  const { selectedDay, timeOfDay, serverDomain, activeVisualizations } = params;

  const [events, setEvents] = useState<CollectionEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dayCounts, setDayCounts] = useState<DayCounts>(new Map());

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
        const buildUrl = (extraParams: Record<string, string>, type: string) => {
          const params = new URLSearchParams(extraParams);
          if (domain) params.set("domain", domain);
          params.set("type", type);
          return `${EVENTS_URL}?${params}`;
        };

        const fetchOne = (
          extraParams: Record<string, string>,
          type: string,
        ): Promise<CollectionEvent[]> =>
          fetch(buildUrl(extraParams, type)).then((r) => {
            if (!r.ok)
              throw new Error(`Failed to fetch ${type} events: ${r.status}`);
            return r.json();
          });

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

  // Refetch when the day, server-side domain, time-of-day window, or active
  // visualizations change. time-of-day must refetch because the midnight window
  // is fetched server-side (a tight from/to bracket), not just filtered
  // client-side; active-viz changes fetch any missing event types. A single
  // effect (rather than one per dependency group) so mount fires ONE fetch —
  // two effects both ran on the first render, and the duplicate fetch's late
  // resolution rebuilt the trail set and restarted the animation mid-reveal.
  useEffect(() => {
    fetchEvents(selectedDay, activeVisualizations, serverDomain, false, timeOfDay);
  }, [selectedDay, serverDomain, timeOfDay, activeVisualizations, fetchEvents]);

  const refresh = useCallback(() => {
    fetchedTypesRef.current = new Set();
    lastFetchKeyRef.current = "";
    fetchEvents(selectedDay, activeVisualizations, serverDomain, true, timeOfDay);
  }, [selectedDay, serverDomain, activeVisualizations, timeOfDay, fetchEvents]);

  return { events, loading, error, dayCounts, refresh };
}
