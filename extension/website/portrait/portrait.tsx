// ABOUTME: Entry point for the Internet Movement visualization page
// ABOUTME: Fetches events from the server API and passes them to MovementCanvas for rendering
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
  parseDomainFromUrl,
  parseVizFromUrl,
} from "../shared/config";

const EVENTS_URL = RECENT_EVENTS_URL;

const InternetMovement = () => {
  const [events, setEvents] = useState<CollectionEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dayCounts, setDayCounts] = useState<DayCounts>(new Map());
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [domainFilter, setDomainFilter] = useState<string>(() => {
    // URL wins. Otherwise mirror whatever MovementCanvas will load from
    // localStorage on first render — if portrait disagrees on mount, the
    // bidirectional sync between portrait.domainFilter and
    // MovementCanvas.settings.domainFilter ping-pongs forever (each side
    // re-asserts its initial value from a separate effect on every render).
    const fromUrl = parseDomainFromUrl();
    if (fromUrl !== undefined) return fromUrl;
    try {
      const stored = localStorage.getItem("internet-movement-settings-v2");
      if (stored) {
        const parsed = JSON.parse(stored);
        if (typeof parsed?.domainFilter === "string") return parsed.domainFilter;
      }
    } catch { /* ignore */ }
    return "";
  });
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
    ) => {
      const requiredTypes = deriveRequiredEventTypes(vizIds);

      if (requiredTypes.size === 0) {
        setLoading(false);
        return;
      }

      // Force refresh when the filter context (day+domain) changed
      const fetchKey = `${day ?? "all"}|${domain}`;
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
        // Single-day fetch: scope tightly with the original limit.
        // No-day fetch: a single broad request hits the worker's order-by-ts
        // cap and returns only the newest few hours. To get genuine multi-
        // day coverage for the activity strip, fan out one request per day
        // across the recent window. Each per-day request caps at a small
        // limit (still gives a representative sample for unique-pid signal),
        // and they parallelize so total page-load latency stays acceptable.
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
        if (day) {
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
          // Fan out across the last DAYS_BACK days. Per-day limit kept
          // modest so total payload stays bounded — the strip needs spread,
          // not depth, and the per-day samples are enough to estimate
          // unique-pid presence per bucket.
          const DAYS_BACK = 14;
          const PER_DAY_LIMIT = 800;
          const today = new Date();
          today.setHours(0, 0, 0, 0);
          const dayKeys: string[] = [];
          for (let i = 0; i < DAYS_BACK; i++) {
            const d = new Date(today.getTime() - i * 24 * 60 * 60 * 1000);
            const y = d.getFullYear();
            const m = String(d.getMonth() + 1).padStart(2, "0");
            const dd = String(d.getDate()).padStart(2, "0");
            dayKeys.push(`${y}-${m}-${dd}`);
          }
          // Throttle: 14 days × N types = up to 56 requests if we go fully
          // parallel, which can saturate connection limits and produce
          // sporadic `TypeError: Failed to fetch` from the browser. Run in
          // small batches so the browser stays under its concurrent-request
          // ceiling.
          const allTasks: Array<{ dayKey: string; type: string }> = [];
          for (const dayKey of dayKeys) {
            for (const type of typesToFetch) {
              allTasks.push({ dayKey, type });
            }
          }
          const BATCH_SIZE = 6;
          const results: CollectionEvent[][] = [];
          for (let i = 0; i < allTasks.length; i += BATCH_SIZE) {
            const batch = allTasks.slice(i, i + BATCH_SIZE);
            const batchResults = await Promise.all(
              batch.map(({ dayKey, type }) =>
                fetchOne(
                  {
                    limit: String(PER_DAY_LIMIT),
                    from: dayKey,
                    to: `${dayKey}T23:59:59Z`,
                  },
                  type,
                ).catch((err) => {
                  // Don't fail the whole load when one day errors — just
                  // skip it and let the rest populate.
                  console.warn(`Failed to fetch ${dayKey}/${type}:`, err);
                  return [] as CollectionEvent[];
                }),
              ),
            );
            results.push(...batchResults);
          }
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

  // When day or domain filter changes, refetch with server-side filtering
  useEffect(() => {
    fetchEvents(selectedDay, activeVisualizations, domainFilter);
  }, [selectedDay, domainFilter]);

  // When active visualizations change, fetch any missing event types
  useEffect(() => {
    fetchEvents(selectedDay, activeVisualizations, domainFilter);
  }, [activeVisualizations]);

  const handleRefresh = useCallback(() => {
    fetchedTypesRef.current = new Set();
    lastFetchKeyRef.current = "";
    fetchEvents(selectedDay, activeVisualizations, domainFilter, true);
  }, [selectedDay, domainFilter, activeVisualizations, fetchEvents]);

  return (
    <>
      <span
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
        domainFilter={domainFilter}
        onSetDomainFilter={setDomainFilter}
        activeVisualizations={activeVisualizations}
        onSetActiveVisualizations={setActiveVisualizations}
      />
    </>
  );
};

ReactDOM.createRoot(
  document.getElementById("reactContent") as HTMLElement,
).render(<InternetMovement />);
