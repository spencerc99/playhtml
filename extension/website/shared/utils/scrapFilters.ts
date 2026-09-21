// ABOUTME: Matches scraps against saved source locations and searchable text.
// ABOUTME: Retains complete photo provenance when any encounter matches a filter.

import type { ScrapItem } from "../components/ScrapCollage";
import { eventMatchesAnyFilter, type FilterChip } from "./eventUtils";

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
