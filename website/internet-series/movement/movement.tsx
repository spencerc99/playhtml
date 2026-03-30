// ABOUTME: Entry point for the Internet Movement visualization page
// ABOUTME: Fetches events from the server API and passes them to MovementCanvas for rendering
import "./movement.scss";
import React, { useState, useEffect, useCallback, useRef } from "react";
import ReactDOM from "react-dom/client";
import { CollectionEvent, DayCounts } from "./types";
import { MovementCanvas } from "./components/MovementCanvas";
import {
  deriveRequiredEventTypes,
  DEFAULT_ACTIVE_VISUALIZATIONS,
} from "./components/registry";

const API_BASE =
  "https://playhtml-game-api.spencerc99.workers.dev";
const EVENTS_URL = `${API_BASE}/events/recent`;
const DAILY_COUNTS_URL = `${API_BASE}/events/daily-counts`;

const InternetMovement = () => {
  const [events, setEvents] = useState<CollectionEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dayCounts, setDayCounts] = useState<DayCounts>(new Map());
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [domainFilter, setDomainFilter] = useState<string>("");
  const [activeVisualizations, setActiveVisualizations] = useState<string[]>(
    DEFAULT_ACTIVE_VISUALIZATIONS,
  );

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
        const params = new URLSearchParams({ limit: "5000" });
        if (day) {
          params.set("from", day);
          params.set("to", `${day}T23:59:59Z`);
        }
        if (domain) {
          params.set("domain", domain);
        }

        const promises: Promise<CollectionEvent[]>[] = [...typesToFetch].map(
          (type) =>
            fetch(`${EVENTS_URL}?${params}&type=${type}`).then((r) => {
              if (!r.ok)
                throw new Error(`Failed to fetch ${type} events: ${r.status}`);
              return r.json();
            }),
        );

        const results = await Promise.all(promises);
        const fetched = results.flat();

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
