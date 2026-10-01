// ABOUTME: Matches scraps against saved source locations, searchable text, when they were seen, and shape.
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

/** The outline a scrap has in the collage, read from its own proportions. */
export type ScrapShape = "tall" | "square" | "wide";

/** How far a scrap's width-to-height ratio may lean from 1:1 and still count as square. */
const SQUARE_TOLERANCE = 1.25;

/**
 * Photos and icons take the shape of their own pixels, buttons and headings
 * are runs of words and always sit wide, and cursors are drawn in a square
 * tile. A scrap whose size was never measured has no shape.
 */
export function scrapShape(item: ScrapItem): ScrapShape | null {
  switch (item.kind) {
    case "image":
      return shapeOf(item.naturalWidth, item.naturalHeight);
    case "svg-icon":
      return shapeOf(item.width, item.height);
    case "button":
    case "heading":
      return "wide";
    case "cursor":
      return "square";
  }
}

function shapeOf(width: number, height: number): ScrapShape | null {
  if (!(width > 0) || !(height > 0)) return null;
  const ratio = width / height;
  if (ratio > SQUARE_TOLERANCE) return "wide";
  if (ratio < 1 / SQUARE_TOLERANCE) return "tall";
  return "square";
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
      : item.kind === "button" || item.kind === "heading"
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
