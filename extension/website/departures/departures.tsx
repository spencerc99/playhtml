// ABOUTME: Entry point for the departures board page on wewere.online.
// ABOUTME: Seeds the board from recent history, then flips in live departures from the stream.

import "./departures.scss";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import ReactDOM from "react-dom/client";
import { Departures } from "../shared/components/Departures";
import { RECENT_EVENTS_URL } from "../shared/config";
import { useLiveEvents } from "../shared/hooks/useLiveEvents";
import { CollectionEvent } from "../shared/types";

const REFRESH_INTERVAL_MS = 60_000;

function DeparturesPage() {
  const [events, setEvents] = useState<CollectionEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const { events: liveEvents } = useLiveEvents({ types: ["navigation"] });

  const fetchEvents = useCallback(async () => {
    const params = new URLSearchParams({ type: "navigation", limit: "1000" });
    try {
      const response = await fetch(`${RECENT_EVENTS_URL}?${params}`);
      if (!response.ok) {
        throw new Error(`Failed to fetch navigation events: ${response.status}`);
      }
      setEvents(await response.json());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch events");
      console.error("Error fetching events:", err);
    }
  }, []);

  useEffect(() => {
    fetchEvents();
    const interval = setInterval(fetchEvents, REFRESH_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [fetchEvents]);

  // History + live stream, deduped by id (the periodic refetch overlaps the
  // stream once a live event lands in the database).
  const mergedEvents = useMemo(() => {
    const byId = new Map<string, CollectionEvent>();
    for (const e of events) byId.set(e.id, e);
    for (const e of liveEvents) byId.set(e.id, e);
    return [...byId.values()];
  }, [events, liveEvents]);

  return (
    <main className="departures-page">
      <Departures events={mergedEvents} maxRows={20} />
      {error && <p className="departures-error">{error}</p>}
    </main>
  );
}

ReactDOM.createRoot(document.getElementById("reactContent")!).render(
  <DeparturesPage />,
);
