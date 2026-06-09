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

  // Ids of events we've already accepted, so the server's buffer replay (it
  // re-sends its whole ring buffer on EVERY connect, including reconnects)
  // never re-adds an event we already showed — which would make an aged-out
  // trail disappear and then reappear. This must remember far more ids than the
  // display holds: a reconnect can replay events that already scrolled off the
  // visible window, so the seen-set is bounded by its own FIFO (evict oldest),
  // NOT rebuilt from the current event array.
  const seenIdsRef = useRef<Set<string>>(new Set());
  const seenOrderRef = useRef<string[]>([]);
  // Comfortably larger than both the display cap and the server ring buffer, so
  // any id the server could replay is still remembered.
  const SEEN_LIMIT = 2000;

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
        let frame: StreamFrame;
        try {
          frame = JSON.parse(msg.data as string) as StreamFrame;
        } catch (err) {
          // A malformed frame is unexpected — surface it rather than silently
          // showing "no activity" (which is indistinguishable from a quiet net).
          console.warn("[useLiveEvents] dropped unparseable frame:", err);
          return;
        }
        if (!Array.isArray(frame.events)) {
          console.warn("[useLiveEvents] frame missing events array:", frame);
          return;
        }
        if (frame.events.length === 0) return; // empty batch — normal
        const seen = seenIdsRef.current;
        const order = seenOrderRef.current;
        const incoming = frame.events.filter((e) => {
          if (!e.id) {
            // event.id is a required field upstream; a missing one means the
            // ingest/enrichment pipeline produced a malformed event.
            console.warn("[useLiveEvents] event without id (upstream bug):", e);
            return false;
          }
          if (seen.has(e.id)) return false;
          seen.add(e.id);
          order.push(e.id);
          return true;
        });
        // Bound the seen-set by its own FIFO, evicting the OLDEST ids — never
        // by the display array. Evicted ids are old enough that the server's
        // ring buffer no longer holds them, so they can't be replayed.
        if (order.length > SEEN_LIMIT) {
          const removeCount = order.length - SEEN_LIMIT;
          for (let i = 0; i < removeCount; i++) seen.delete(order[i]);
          order.splice(0, removeCount);
        }
        if (incoming.length === 0) return;
        setEvents((prev) => {
          const next = [...prev, ...incoming];
          return next.length > maxRef.current
            ? next.slice(next.length - maxRef.current)
            : next;
        });
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
