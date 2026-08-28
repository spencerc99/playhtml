// ABOUTME: Entry point for the departures board page on wewere.online.
// ABOUTME: Fetches recent navigation events and renders them as a station board.

import "./departures.scss";
import React, { useCallback, useEffect, useState } from "react";
import ReactDOM from "react-dom/client";
import { Departures } from "../shared/components/Departures";
import { RECENT_EVENTS_URL } from "../shared/config";
import { CollectionEvent } from "../shared/types";

const REFRESH_INTERVAL_MS = 60_000;

function DeparturesPage() {
  const [events, setEvents] = useState<CollectionEvent[]>([]);
  const [error, setError] = useState<string | null>(null);

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

  return (
    <main className="departures-page">
      <Departures events={events} maxRows={12} />
      {error && <p className="departures-error">{error}</p>}
    </main>
  );
}

ReactDOM.createRoot(document.getElementById("reactContent")!).render(
  <DeparturesPage />,
);
