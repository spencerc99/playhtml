// ABOUTME: Entry point for the Internet Keypresses visualization
// ABOUTME: Fetches keyboard events from the server API and passes them to KeypressesGrid
import "./keypresses.scss";
import React, { useState, useEffect } from "react";
import ReactDOM from "react-dom/client";
import { CollectionEvent } from "./types";
import { KeypressesGrid } from "./components/KeypressesGrid";

const API_URL =
  "https://playhtml-game-api.spencerc99.workers.dev/events/recent";

const InternetKeypresses = () => {
  const [events, setEvents] = useState<CollectionEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchEvents = async () => {
    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams({ limit: "5000" });
      const response = await fetch(`${API_URL}?${params}&type=keyboard`);
      if (!response.ok)
        throw new Error(`Failed to fetch keyboard events: ${response.status}`);
      const data: CollectionEvent[] = await response.json();
      setEvents(data);
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
    <KeypressesGrid
      events={events}
      loading={loading}
      error={error}
      onRefresh={fetchEvents}
    />
  );
};

ReactDOM.createRoot(
  document.getElementById("reactContent") as HTMLElement,
).render(<InternetKeypresses />);
