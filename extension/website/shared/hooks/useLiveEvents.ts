// ABOUTME: Subscribes to the worker's /stream WebSocket and accumulates a bounded
// ABOUTME: list of recent CollectionEvents for live visualization.

import { useEffect, useRef, useState } from "react";
import type { CollectionEvent } from "../types";
import { STREAM_URL } from "../config";

interface StreamFrame {
  events: CollectionEvent[];
}

interface UseLiveEventsOptions {
  /** Max events retained in memory. Older events fall off the front. */
  maxEvents?: number;
}

interface UseLiveEventsResult {
  events: CollectionEvent[];
  connected: boolean;
}

/**
 * Open a WebSocket to the live event stream and keep the most recent
 * `maxEvents` events. Reconnects with capped backoff on drop. The server
 * replays its ring buffer on connect, so the list is non-empty quickly when
 * there is recent activity.
 */
export function useLiveEvents(
  options: UseLiveEventsOptions = {},
): UseLiveEventsResult {
  const maxEvents = options.maxEvents ?? 500;
  const [events, setEvents] = useState<CollectionEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const maxRef = useRef(maxEvents);
  maxRef.current = maxEvents;

  useEffect(() => {
    let ws: WebSocket | null = null;
    let closed = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
    let backoffMs = 1000;

    const connect = () => {
      if (closed) return;
      ws = new WebSocket(STREAM_URL);

      ws.onopen = () => {
        setConnected(true);
        backoffMs = 1000;
      };

      ws.onmessage = (msg) => {
        try {
          const frame = JSON.parse(msg.data as string) as StreamFrame;
          if (!Array.isArray(frame.events) || frame.events.length === 0) return;
          setEvents((prev) => {
            const next = [...prev, ...frame.events];
            return next.length > maxRef.current
              ? next.slice(next.length - maxRef.current)
              : next;
          });
        } catch {
          // ignore malformed frames
        }
      };

      ws.onclose = () => {
        setConnected(false);
        if (closed) return;
        reconnectTimer = setTimeout(connect, backoffMs);
        backoffMs = Math.min(backoffMs * 2, 15000);
      };

      ws.onerror = () => {
        // onclose will fire next and schedule the reconnect.
        ws?.close();
      };
    };

    connect();

    return () => {
      closed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      ws?.close();
    };
  }, []);

  return { events, connected };
}
