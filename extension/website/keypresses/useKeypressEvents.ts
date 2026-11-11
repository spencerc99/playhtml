// ABOUTME: Loads keyboard events page by page for the keypresses visualization, filtered by domain.
// ABOUTME: A new domain or refresh aborts the in-flight load so only the latest request's events show.
import { useState, useEffect, useCallback, useRef } from "react";
import type { CollectionEvent } from "../shared/types";

export interface KeypressEvents {
  events: CollectionEvent[];
  loading: boolean;
  error: string | null;
  hasMore: boolean;
  refresh: () => void;
  fetchOlder: () => void;
}

export function useKeypressEvents(
  apiUrl: string,
  pageSize: number,
  domain: string,
): KeypressEvents {
  const [events, setEvents] = useState<CollectionEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const requestRef = useRef<AbortController | null>(null);

  const fetchPage = useCallback(
    async (pageDomain: string, beforeTs?: number) => {
      // Pagination waits for the current request; a first page replaces it.
      if (beforeTs !== undefined && requestRef.current) return;
      requestRef.current?.abort();
      const controller = new AbortController();
      requestRef.current = controller;

      if (beforeTs === undefined) {
        setLoading(true);
        setHasMore(true);
        setEvents([]);
      }
      setError(null);

      try {
        const params = new URLSearchParams({
          limit: String(pageSize),
          type: "keyboard",
        });
        if (pageDomain) params.set("domain", pageDomain);
        if (beforeTs !== undefined) {
          params.set("to", new Date(beforeTs - 1).toISOString());
        }
        const response = await fetch(`${apiUrl}?${params}`, {
          signal: controller.signal,
        });
        if (!response.ok)
          throw new Error(`Failed to fetch keyboard events: ${response.status}`);
        const data: CollectionEvent[] = await response.json();
        if (controller.signal.aborted) return;

        if (data.length === 0) {
          setHasMore(false);
        } else {
          setEvents((prev) =>
            beforeTs !== undefined ? [...prev, ...data] : data,
          );
          if (data.length < pageSize) setHasMore(false);
        }
      } catch (err) {
        if (controller.signal.aborted) return;
        setError(err instanceof Error ? err.message : "Failed to fetch events");
        console.error("Error fetching events:", err);
      } finally {
        if (requestRef.current === controller) {
          requestRef.current = null;
          setLoading(false);
        }
      }
    },
    [apiUrl, pageSize],
  );

  useEffect(() => {
    fetchPage(domain);
  }, [domain, fetchPage]);

  useEffect(() => () => requestRef.current?.abort(), []);

  const refresh = useCallback(() => {
    fetchPage(domain);
  }, [domain, fetchPage]);

  const fetchOlder = useCallback(() => {
    if (!hasMore || requestRef.current || events.length === 0) return;
    const oldestTs = Math.min(...events.map((e) => e.ts));
    fetchPage(domain, oldestTs);
  }, [events, hasMore, domain, fetchPage]);

  return { events, loading, error, hasMore, refresh, fetchOlder };
}
