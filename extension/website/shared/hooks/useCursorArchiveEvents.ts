// ABOUTME: Captures archive cursor footage without events already present in the live field.
// ABOUTME: Keeps each archive batch intact while subsequent live events arrive.

import { useMemo, useRef } from "react";
import type { CollectionEvent } from "../types";

export function useCursorArchiveEvents(
  archiveEvents: CollectionEvent[],
  liveEvents: CollectionEvent[],
): CollectionEvent[] {
  const liveEventsRef = useRef(liveEvents);
  liveEventsRef.current = liveEvents;
  return useMemo(() => {
    const liveIds = new Set(liveEventsRef.current.map((event) => event.id));
    return archiveEvents.filter((event) => !liveIds.has(event.id));
  }, [archiveEvents]);
}
