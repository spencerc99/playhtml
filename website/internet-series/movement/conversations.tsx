// ABOUTME: Entry point for the Internet Conversations visualization
// ABOUTME: Fetches keyboard events and renders them as a chat conversation between websites
import "./conversations.scss";
import React, { useState, useEffect } from "react";
import ReactDOM from "react-dom/client";
import { CollectionEvent } from "./types";
import { ConversationView } from "./components/ConversationView";

const API_URL =
  "https://playhtml-game-api.spencerc99.workers.dev/events/recent";

function parseStartTime(): Date | null {
  const params = new URLSearchParams(window.location.search);
  const start = params.get("start");
  if (!start) return null;
  const date = new Date(start);
  return isNaN(date.getTime()) ? null : date;
}

const InternetConversations = () => {
  const [events, setEvents] = useState<CollectionEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const startTime = parseStartTime();

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
    <ConversationView
      events={events}
      loading={loading}
      error={error}
      startTime={startTime}
    />
  );
};

ReactDOM.createRoot(
  document.getElementById("reactContent") as HTMLElement,
).render(<InternetConversations />);
