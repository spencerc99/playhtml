// ABOUTME: Progressively fetches archive cursor events into a deep candidate pool
// ABOUTME: Shows the newest page immediately, then auto-pages older events to a cap

import { useEffect, useState } from "react";
import { CollectionEvent } from "../types";
import { RECENT_EVENTS_URL } from "../config";

const PAGE_SIZE = 20000;

export interface CursorEventPool {
  events: CollectionEvent[];
  /** True until the first page has landed. */
  loading: boolean;
  /** True while older pages are still being fetched in the background. */
  deepening: boolean;
  error: string | null;
}

export function useCursorEventPool(
  domain: string,
  maxEvents: number,
): CursorEventPool {
  const [events, setEvents] = useState<CollectionEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [deepening, setDeepening] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setEvents([]);
    setLoading(true);
    setDeepening(false);
    setError(null);

    const fetchPage = async (
      beforeTs?: number,
    ): Promise<CollectionEvent[]> => {
      const params = new URLSearchParams({
        type: "cursor",
        limit: String(PAGE_SIZE),
      });
      if (domain) params.set("domain", domain);
      if (beforeTs) params.set("to", new Date(beforeTs - 1).toISOString());

      const response = await fetch(`${RECENT_EVENTS_URL}?${params}`);
      if (!response.ok)
        throw new Error(`Failed to fetch cursor events: ${response.status}`);
      return response.json();
    };

    (async () => {
      try {
        let all = await fetchPage();
        if (cancelled) return;
        setEvents(all);
        setLoading(false);
        if (all.length < PAGE_SIZE) return;

        setDeepening(true);
        while (!cancelled && all.length < maxEvents) {
          const oldestTs = Math.min(...all.map((e) => e.ts));
          const page = await fetchPage(oldestTs);
          if (cancelled) return;
          if (page.length === 0) break;
          all = [...all, ...page];
          setEvents(all);
          if (page.length < PAGE_SIZE) break;
        }
      } catch (err) {
        if (!cancelled)
          setError(err instanceof Error ? err.message : "Failed to fetch");
      } finally {
        if (!cancelled) {
          setLoading(false);
          setDeepening(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [domain, maxEvents]);

  return { events, loading, deepening, error };
}
