// ABOUTME: Matches scraps against saved source locations, searchable text, and when they were seen.
// ABOUTME: Retains complete photo provenance when any encounter matches a filter.

import type { ScrapItem } from "../components/ScrapCollage";
import type { TimeOfDayFilter } from "../config";
import { eventMatchesAnyFilter, type FilterChip } from "./eventUtils";
import { localDayKey, timeOfDayMatches } from "./timeOfDay";

/** A local calendar day and a recurring local time-of-day window, either optional. */
export interface ScrapWhenFilter {
  day: string | null;
  timeOfDay: TimeOfDayFilter | null;
}

export const ANY_TIME: ScrapWhenFilter = { day: null, timeOfDay: null };

export function isAnyTime(when: ScrapWhenFilter): boolean {
  return when.day === null && when.timeOfDay === null;
}

export function scrapLocations(item: ScrapItem) {
  return [
    item,
    ...(item.sources ?? []).flatMap((source) => [source, ...source.encounters]),
  ];
}

export function matchesScrapFilters(
  item: ScrapItem,
  places: FilterChip[],
  search: string,
): boolean {
  const locations = scrapLocations(item);
  if (
    !locations.some((source) => eventMatchesAnyFilter(source.pageUrl, places))
  )
    return false;
  const words = search.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const text = [
    ...locations.flatMap((source) => [
      source.pageTitle,
      source.pageUrl,
      source.domain,
    ]),
    item.kind === "image"
      ? (item.alt ?? "")
      : item.kind === "button"
        ? item.text
        : "",
  ]
    .join(" ")
    .toLowerCase();
  return words.every((word) => text.includes(word));
}

/**
 * Every moment a scrap is known to have been seen: when it was first kept,
 * plus each source page's latest visit and each day's latest encounter.
 */
export function scrapSightings(item: ScrapItem): number[] {
  return Array.from(new Set(scrapLocations(item).map((source) => source.ts)));
}

/**
 * Whether one sighting of the scrap falls on the day and inside the time of
 * day, both in the viewer's local time. The same sighting has to satisfy
 * both, so "Tuesday, evenings" means seen on a Tuesday evening.
 */
export function matchesScrapWhen(
  item: ScrapItem,
  when: ScrapWhenFilter,
): boolean {
  if (isAnyTime(when)) return true;
  return scrapSightings(item).some(
    (ts) =>
      (when.day === null || localDayKey(ts) === when.day) &&
      (when.timeOfDay === null || timeOfDayMatches(ts, when.timeOfDay)),
  );
}

/**
 * The local days each scrap was seen on, limited to sightings inside the time
 * of day when one is set. A scrap seen on several days belongs to each.
 */
export function scrapDays(
  item: ScrapItem,
  timeOfDay: TimeOfDayFilter | null,
): Set<string> {
  const days = new Set<string>();
  for (const ts of scrapSightings(item)) {
    if (timeOfDay === null || timeOfDayMatches(ts, timeOfDay))
      days.add(localDayKey(ts));
  }
  return days;
}
