// ABOUTME: Live "people browsing" readout: everyone with an event in the last
// ABOUTME: couple of minutes, even after their events leave the bounded list.

import { useEffect, useRef, useState } from "react";
import type { CollectionEvent } from "../types";
import {
  ACTIVE_PEOPLE_WINDOW_MS,
  recordLastSeen,
  summarizeLastSeen,
  type ActiveLocations,
  type LastSeenByPerson,
} from "../utils/eventUtils";

/** How often the readout re-counts, so people age out while the stream is quiet. */
const RECOUNT_MS = 5_000;

/**
 * Count people active in the last `windowMs`. Live pages keep only the newest
 * few hundred events, which on a busy day covers well under the window, so this
 * remembers each person's last-seen time separately from that list.
 */
export function useActiveLocations(
  events: CollectionEvent[],
  windowMs: number = ACTIVE_PEOPLE_WINDOW_MS,
): ActiveLocations {
  const lastSeenRef = useRef<LastSeenByPerson>(new Map());
  const [activity, setActivity] = useState<ActiveLocations>({
    people: 0,
    timezones: 0,
    continents: 0,
  });

  useEffect(() => {
    const now = Date.now();
    recordLastSeen(lastSeenRef.current, events, now);
    setActivity(summarizeLastSeen(lastSeenRef.current, windowMs, now));
  }, [events, windowMs]);

  useEffect(() => {
    const timer = setInterval(() => {
      setActivity((prev) => {
        const next = summarizeLastSeen(lastSeenRef.current, windowMs);
        return next.people === prev.people &&
          next.timezones === prev.timezones &&
          next.continents === prev.continents
          ? prev
          : next;
      });
    }, RECOUNT_MS);
    return () => clearInterval(timer);
  }, [windowMs]);

  return activity;
}
