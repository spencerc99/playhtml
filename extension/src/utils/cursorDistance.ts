// ABOUTME: Measures cursor travel without joining separate page visits or stale samples.
// ABOUTME: Selects the cursor events used by domain and page portrait statistics.

import type { CollectionEvent } from "@playhtml/extension-types";
import type { CursorEventData } from "../collectors/types";
import type {
  LocalEventStore,
  QueryOptions,
} from "../storage/LocalEventStore";
import { normalizeUrl } from "./urlNormalization";

const MAX_CURSOR_SAMPLE_GAP_MS = 5_000;
const PORTRAIT_CURSOR_QUERY: QueryOptions = {
  type: "cursor",
  limit: 2_000,
};

type PortraitCursorEventStore = Pick<
  LocalEventStore,
  "queryByDomain" | "queryByUrl"
>;

interface CursorDistanceEvent {
  type: string;
  ts: number;
  data: unknown;
  normalizedUrl?: string;
  meta: {
    url: string;
    vw: number;
    vh: number;
  };
}

export function queryCursorEventsForPortrait(
  store: PortraitCursorEventStore,
  domain: string,
  rawUrl?: string,
): Promise<CollectionEvent[]> {
  return rawUrl
    ? store.queryByUrl(rawUrl, PORTRAIT_CURSOR_QUERY)
    : store.queryByDomain(domain, PORTRAIT_CURSOR_QUERY);
}

export function calculateCursorDistance(events: CursorDistanceEvent[]): number {
  const moves = events
    .filter((event) => {
      if (event.type !== "cursor") return false;
      const data = event.data as CursorEventData;
      return (
        (data.event === "move" || data.event === undefined) &&
        Number.isFinite(data.x) &&
        Number.isFinite(data.y)
      );
    })
    .sort((first, second) => first.ts - second.ts);

  let distance = 0;
  for (let index = 1; index < moves.length; index++) {
    const previousEvent = moves[index - 1];
    const event = moves[index];
    const previousUrl =
      previousEvent.normalizedUrl ?? normalizeUrl(previousEvent.meta.url);
    const currentUrl = event.normalizedUrl ?? normalizeUrl(event.meta.url);
    if (previousUrl !== currentUrl) continue;
    if (event.ts - previousEvent.ts > MAX_CURSOR_SAMPLE_GAP_MS) continue;

    const previous = previousEvent.data as CursorEventData;
    const current = event.data as CursorEventData;
    const width = event.meta.vw || previousEvent.meta.vw;
    const height = event.meta.vh || previousEvent.meta.vh;
    if (!Number.isFinite(width) || !Number.isFinite(height)) continue;

    const dx = (current.x - previous.x) * width;
    const dy = (current.y - previous.y) * height;
    distance += Math.sqrt(dx * dx + dy * dy);
  }

  return distance;
}
