// ABOUTME: Entry point for the Internet Movement visualization page
// ABOUTME: Fetches events from the server API and passes them to MovementCanvas for rendering
import "./movement.scss";
import React, { useState, useEffect } from "react";
import ReactDOM from "react-dom/client";
import { CollectionEvent } from "./types";
import { MovementCanvas } from "./components/MovementCanvas";

const API_URL =
  "https://playhtml-game-api.spencerc99.workers.dev/events/recent";

const InternetMovement = () => {
  const [events, setEvents] = useState<CollectionEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchEvents = async () => {
    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams({ limit: "5000" });

      const promises: Promise<CollectionEvent[]>[] = [
        fetch(`${API_URL}?${params}&type=cursor`).then((r) => {
          if (!r.ok) throw new Error(`Failed to fetch cursor events: ${r.status}`);
          return r.json();
        }),
        fetch(`${API_URL}?${params}&type=keyboard`).then((r) => {
          if (!r.ok) throw new Error(`Failed to fetch keyboard events: ${r.status}`);
          return r.json();
        }),
        fetch(`${API_URL}?${params}&type=viewport`).then((r) => {
          if (!r.ok) throw new Error(`Failed to fetch viewport events: ${r.status}`);
          return r.json();
        }),
        fetch(`${API_URL}?${params}&type=navigation`).then((r) => {
          if (!r.ok) throw new Error(`Failed to fetch navigation events: ${r.status}`);
          return r.json();
        }),
      ];

      const results = await Promise.all(promises);
      setEvents(results.flat());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch events");
      console.error("Error fetching events:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchEvents();
  }, []);

  return (
    <MovementCanvas
      events={events}
      loading={loading}
      error={error}
      fetchEvents={fetchEvents}
    />
  );
};

ReactDOM.createRoot(
  document.getElementById("reactContent") as HTMLElement,
).render(<InternetMovement />);
