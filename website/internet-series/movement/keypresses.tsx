// ABOUTME: Entry point for the Internet Keypresses visualization
// ABOUTME: Fetches keyboard events with pagination and passes them to KeypressesGrid
import "./keypresses.scss";
import React, { useState, useEffect, useCallback, useRef } from "react";
import ReactDOM from "react-dom/client";
import { CollectionEvent } from "./types";
import { KeypressesGrid } from "./components/KeypressesGrid";

const API_URL =
  "https://playhtml-game-api.spencerc99.workers.dev/events/recent";
const PAGE_SIZE = 5000;

const InternetKeypresses = () => {
  const [events, setEvents] = useState<CollectionEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const fetchingRef = useRef(false);

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
        setEvents((prev) => beforeTs ? [...prev, ...data] : data);
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

  useEffect(() => {
    fetchPage();
  }, [fetchPage]);

  const handleRefresh = useCallback(() => {
    setHasMore(true);
    setEvents([]);
    fetchPage();
  }, [fetchPage]);

  const handleFetchOlder = useCallback(() => {
    if (!hasMore || fetchingRef.current || events.length === 0) return;
    const oldestTs = Math.min(...events.map((e) => e.ts));
    fetchPage(oldestTs);
  }, [events, hasMore, fetchPage]);

  return (
    <KeypressesGrid
      events={events}
      loading={loading}
      error={error}
      onRefresh={handleRefresh}
      onFetchOlder={handleFetchOlder}
      hasMore={hasMore}
    />
  );
};

ReactDOM.createRoot(
  document.getElementById("reactContent") as HTMLElement,
).render(<InternetKeypresses />);
