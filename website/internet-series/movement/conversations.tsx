// ABOUTME: Entry point for the Internet Conversations visualization
// ABOUTME: Fetches keyboard events with pagination and renders them as a chat conversation between websites
import "./conversations.scss";
import React, { useState, useEffect, useCallback, useRef } from "react";
import ReactDOM from "react-dom/client";
import { CollectionEvent } from "./types";
import { ConversationView } from "./components/ConversationView";

const API_URL =
  "https://playhtml-game-api.spencerc99.workers.dev/events/recent";
const PAGE_SIZE = 5000;

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
  const [hasMore, setHasMore] = useState(true);
  const fetchingRef = useRef(false);
  const startTime = parseStartTime();

  const fetchPage = useCallback(async (beforeTs?: number) => {
    if (fetchingRef.current) return;
    fetchingRef.current = true;

    if (!beforeTs) setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams({
        limit: String(PAGE_SIZE),
        type: "keyboard",
      });
      // Use 'to' param to fetch events older than the last batch
      if (beforeTs) {
        params.set("to", new Date(beforeTs - 1).toISOString());
      }
      const response = await fetch(`${API_URL}?${params}`);
      if (!response.ok)
        throw new Error(`Failed to fetch keyboard events: ${response.status}`);
      const data: CollectionEvent[] = await response.json();

      if (data.length === 0) {
        setHasMore(false);
      } else {
        setEvents((prev) => [...prev, ...data]);
        if (data.length < PAGE_SIZE) {
          setHasMore(false);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch events");
      console.error("Error fetching events:", err);
    } finally {
      setLoading(false);
      fetchingRef.current = false;
    }
  }, []);

  // Fetch first page on mount
  useEffect(() => {
    fetchPage();
  }, [fetchPage]);

  const handleNeedMore = useCallback(() => {
    if (!hasMore || fetchingRef.current) return;
    // Find the oldest timestamp in current events to paginate from
    if (events.length === 0) return;
    const oldestTs = Math.min(...events.map((e) => e.ts));
    fetchPage(oldestTs);
  }, [events, hasMore, fetchPage]);

  return (
    <ConversationView
      events={events}
      loading={loading}
      error={error}
      startTime={startTime}
      hasMore={hasMore}
      onNeedMore={handleNeedMore}
    />
  );
};

ReactDOM.createRoot(
  document.getElementById("reactContent") as HTMLElement,
).render(<InternetConversations />);
