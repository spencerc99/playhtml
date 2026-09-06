// ABOUTME: Groups viewport collection events into stable scroll-window sessions.
// ABOUTME: Shares the renderer's participant, browser session, URL, and inactivity boundaries.

import type { CollectionEvent } from "../types";
import { SCROLL_SESSION_THRESHOLD } from "./eventUtils";

export interface ScrollEventGroup {
  id: string;
  sessionId: string;
  events: CollectionEvent[];
  startTs: number;
  endTs: number;
}

function scrollSessionId(event: CollectionEvent): string {
  return JSON.stringify([event.meta.pid, event.meta.sid, event.meta.url || ""]);
}

function createScrollEventGroup(
  sessionId: string,
  events: CollectionEvent[],
): ScrollEventGroup {
  const first = events[0];
  const last = events.at(-1) ?? first;
  return {
    id: `${sessionId}:${first.id}`,
    sessionId,
    events,
    startTs: first.ts,
    endTs: last.ts,
  };
}

export function scrollEventGroupHasVisibleActivity(
  group: ScrollEventGroup,
): boolean {
  const scrollEvents = group.events.filter(
    (event) => (event.data as { event?: string })?.event === "scroll",
  );
  const resizeEvents = group.events.filter(
    (event) => (event.data as { event?: string })?.event === "resize",
  );
  const zoomEvents = group.events.filter(
    (event) => (event.data as { event?: string })?.event === "zoom",
  );
  if (scrollEvents.length >= 2) {
    const scrollY = scrollEvents.map(
      (event) => (event.data as { scrollY?: number }).scrollY ?? 0,
    );
    if (Math.max(...scrollY) - Math.min(...scrollY) >= 0.05) {
      return true;
    }
  }

  if (resizeEvents.length >= 2) {
    const widths = resizeEvents.map(
      (event) => (event.data as { width?: number }).width ?? event.meta.vw,
    );
    const heights = resizeEvents.map(
      (event) => (event.data as { height?: number }).height ?? event.meta.vh,
    );
    if (
      Math.max(...widths) - Math.min(...widths) >= 100 ||
      Math.max(...heights) - Math.min(...heights) >= 100
    ) {
      return true;
    }
  }

  if (zoomEvents.length >= 2) {
    const zooms = zoomEvents.map(
      (event) => (event.data as { zoom?: number }).zoom ?? 1,
    );
    if (Math.max(...zooms) - Math.min(...zooms) >= 0.1) return true;
  }

  return false;
}

export function scrollEventGroupHasActivity(group: ScrollEventGroup): boolean {
  const scrollEvents = group.events.filter(
    (event) => (event.data as { event?: string })?.event === "scroll",
  );
  const hasScroll = scrollEvents.some((event, index) => {
    if (index === 0) return false;
    const previous = scrollEvents[index - 1];
    const data = event.data as { scrollX?: number; scrollY?: number };
    const previousData = previous.data as {
      scrollX?: number;
      scrollY?: number;
    };
    return (
      Math.abs((data.scrollX ?? 0) - (previousData.scrollX ?? 0)) > 0.000001 ||
      Math.abs((data.scrollY ?? 0) - (previousData.scrollY ?? 0)) > 0.000001
    );
  });
  if (hasScroll) return true;

  return group.events.some((event) => {
    const eventType = (event.data as { event?: string })?.event;
    return eventType === "resize" || eventType === "zoom";
  });
}

export function groupScrollEvents(
  events: readonly CollectionEvent[],
): ScrollEventGroup[] {
  const eventsBySession = new Map<string, CollectionEvent[]>();

  for (const event of events) {
    if (event.type !== "viewport" || !event.id) continue;
    const sessionId = scrollSessionId(event);
    const sessionEvents = eventsBySession.get(sessionId);
    if (sessionEvents) {
      sessionEvents.push(event);
    } else {
      eventsBySession.set(sessionId, [event]);
    }
  }

  const groups: ScrollEventGroup[] = [];
  for (const [sessionId, sessionEvents] of eventsBySession) {
    const chronological = [...sessionEvents].sort(
      (a, b) => a.ts - b.ts || a.id.localeCompare(b.id),
    );
    let current: CollectionEvent[] = [];

    for (const event of chronological) {
      const previous = current.at(-1);
      if (previous && event.ts - previous.ts > SCROLL_SESSION_THRESHOLD) {
        groups.push(createScrollEventGroup(sessionId, current));
        current = [];
      }
      current.push(event);
    }

    if (current.length > 0) {
      groups.push(createScrollEventGroup(sessionId, current));
    }
  }

  return groups.sort(
    (a, b) => a.startTs - b.startTs || a.id.localeCompare(b.id),
  );
}
