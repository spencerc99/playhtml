// ABOUTME: Historical browsing-portrait page (the archive view) at wewere.online/archive
// ABOUTME: Fetches events from /events/recent and passes them to MovementCanvas for rendering
import "../shared/portrait-styles.scss";
import React, { useState, useEffect, useCallback, useRef } from "react";
import ReactDOM from "react-dom/client";
import { CollectionEvent, DayCounts } from "../shared/types";
import { MovementCanvas } from "../shared/components/MovementCanvas";
import {
  deriveRequiredEventTypes,
  DEFAULT_ACTIVE_VISUALIZATIONS,
} from "../shared/components/registry";
import {
  RECENT_EVENTS_URL,
  DAILY_COUNTS_URL,
  parseFiltersFromUrl,
  parseVizFromUrl,
  parseDayFromUrl,
  parseTimeOfDayFromUrl,
} from "../shared/config";
import type { FilterChip } from "../shared/utils/eventUtils";

const EVENTS_URL = RECENT_EVENTS_URL;

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

export const InternetMovement = () => {
  const [events, setEvents] = useState<CollectionEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dayCounts, setDayCounts] = useState<DayCounts>(new Map());
  const [selectedDay, setSelectedDay] = useState<string | null>(
    () => parseDayFromUrl() ?? null,
  );
  const [timeOfDay, setTimeOfDay] = useState(() => parseTimeOfDayFromUrl() ?? null);
  const [filters, setFilters] = useState<FilterChip[]>(() => {
    // URL wins. Otherwise mirror whatever MovementCanvas will load from
    // localStorage on first render — if portrait disagrees on mount, the
    // bidirectional sync between portrait.filters and
    // MovementCanvas.settings.filters ping-pongs forever (each side
    // re-asserts its initial value from a separate effect on every render).
    const fromUrl = parseFiltersFromUrl();
    if (fromUrl !== undefined) return fromUrl;
    try {
      const stored = localStorage.getItem("internet-movement-settings-v2");
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed?.filters)) return parsed.filters;
      }
    } catch { /* ignore */ }
    return [];
  });

  /** Server-side fetch optimization: when the chip list is exactly one
   * chip with a domain set, we can ask the worker to pre-filter by that
   * domain (the existing `?domain=` query param). Any other shape (zero
   * chips, multiple chips, or a chip with only a path) requires a broad
   * fetch so client-side OR-filtering has all the events to work with. */
  const serverDomain =
    filters.length === 1 && filters[0].domain ? filters[0].domain : "";
  const [activeVisualizations, setActiveVisualizations] = useState<string[]>(
    () => {
      // URL param wins over localStorage so capture runs are deterministic.
      const fromUrl = parseVizFromUrl();
      if (fromUrl !== undefined) return fromUrl;
      try {
        const stored = localStorage.getItem("movement_active_viz");
        if (stored) return JSON.parse(stored);
      } catch { /* ignore */ }
      return DEFAULT_ACTIVE_VISUALIZATIONS;
    },
  );

  // Persist visualization selection. Skip the persist when a URL override is
  // present so capture runs don't poison the user's saved preference.
  const vizUrlOverrideRef = useRef(parseVizFromUrl() !== undefined);
  useEffect(() => {
    if (vizUrlOverrideRef.current) return;
    localStorage.setItem("movement_active_viz", JSON.stringify(activeVisualizations));
  }, [activeVisualizations]);

  // Track which event types we've already fetched so we only fetch missing ones
  const fetchedTypesRef = useRef<Set<string>>(new Set());
  // Track the last domain+day combo we fetched for so we know when to force refresh
  const lastFetchKeyRef = useRef<string>("");
  // Ignore any request that completed after a newer filter request started.
  const requestGenerationRef = useRef(0);

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
      tod: ReturnType<typeof parseTimeOfDayFromUrl> | null = null,
    ) => {
      const requestGeneration = ++requestGenerationRef.current;
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

        if (requestGeneration !== requestGenerationRef.current) return;

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
        if (requestGeneration !== requestGenerationRef.current) return;
        setError(err instanceof Error ? err.message : "Failed to fetch events");
        console.error("Error fetching events:", err);
      } finally {
        if (requestGeneration !== requestGenerationRef.current) return;
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
  }, [selectedDay, serverDomain, timeOfDay, activeVisualizations]);

  const handleRefresh = useCallback(() => {
    fetchedTypesRef.current = new Set();
    lastFetchKeyRef.current = "";
    fetchEvents(selectedDay, activeVisualizations, serverDomain, true, timeOfDay);
  }, [selectedDay, serverDomain, activeVisualizations, timeOfDay, fetchEvents]);

  return (
    <>
      <span
        className="wordmark-signature"
        style={{
          position: "absolute",
          top: 14,
          left: 20,
          zIndex: 200,
          fontFamily: "'Source Serif 4', 'Lora', Georgia, serif",
          fontStyle: "italic",
          fontWeight: 200,
          fontSize: "20px",
          color: "#3d3833",
          pointerEvents: "none",
        }}
      >
        we were online
      </span>
      <MovementCanvas
        events={events}
        loading={loading}
        error={error}
        fetchEvents={handleRefresh}
        dayCounts={dayCounts}
        selectedDay={selectedDay}
        onSelectDay={setSelectedDay}
        timeOfDay={timeOfDay}
        onSetTimeOfDay={setTimeOfDay}
        filters={filters}
        onSetFilters={setFilters}
        activeVisualizations={activeVisualizations}
        onSetActiveVisualizations={setActiveVisualizations}
      />
    </>
  );
};

const root = document.getElementById("reactContent");
if (root) {
  ReactDOM.createRoot(root).render(<InternetMovement />);
}
