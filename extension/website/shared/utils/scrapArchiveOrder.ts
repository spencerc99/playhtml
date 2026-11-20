// ABOUTME: Orders the scraps archive: sorts by newest or most seen, then gathers them into groups.
// ABOUTME: Groups are by site, day or kind, and each scrap carries the index of the group it sits in.

import type { ScrapItem } from "../components/ScrapCollage";

export type ScrapGroupBy = "none" | "site" | "day" | "kind";
export type ScrapSort = "newest" | "most-seen";

export const SCRAP_GROUP_OPTIONS: readonly ScrapGroupBy[] = [
  "none",
  "site",
  "day",
  "kind",
];
export const SCRAP_SORT_OPTIONS: readonly ScrapSort[] = ["newest", "most-seen"];

/** One group in the ordered archive: what its label names, and how many it holds. */
export interface ScrapArchiveGroup {
  key: string;
  label: string;
  count: number;
  /** The group's first scrap, whose favicon a site label shows. */
  first: ScrapItem;
}

export interface ScrapArchiveOrder {
  items: ScrapItem[];
  /** The group of each item, by position; empty when nothing is grouped. */
  groupOf: number[];
  groups: ScrapArchiveGroup[];
}

const KIND_LABELS: Record<ScrapItem["kind"], string> = {
  image: "photos",
  button: "buttons",
  "svg-icon": "icons",
  heading: "headings",
  cursor: "cursors",
};

/** How many times a scrap was met: once per page per day for a photo, once per day otherwise. */
export function scrapEncounters(item: ScrapItem): number {
  return Math.max(1, item.encounterCount ?? 1);
}

function localDayKey(timestamp: number): string {
  const date = new Date(timestamp);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

let dayFormatter: Intl.DateTimeFormat | undefined;
let yearDayFormatter: Intl.DateTimeFormat | undefined;

function formatDay(timestamp: number, now: number): string {
  const sameYear =
    new Date(timestamp).getFullYear() === new Date(now).getFullYear();
  if (sameYear) {
    // Short enough that a day with one scrap still fits its label.
    dayFormatter ??= new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
    });
    return dayFormatter.format(timestamp);
  }
  yearDayFormatter ??= new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  return yearDayFormatter.format(timestamp);
}

function groupKey(item: ScrapItem, groupBy: ScrapGroupBy): string {
  switch (groupBy) {
    case "site":
      return item.domain;
    case "day":
      return localDayKey(item.ts);
    case "kind":
      return item.kind;
    case "none":
      return "";
  }
}

/**
 * Orders the archive. Scraps sort by `rank` first when given (a search scored
 * by meaning), then newest first or most seen first. Grouping keeps that order
 * inside each group: days run newest first, and sites and kinds run in the
 * order their best scrap reached, so the top of the archive stays the top.
 */
export function orderScrapArchive(
  items: readonly ScrapItem[],
  options: {
    groupBy: ScrapGroupBy;
    sort: ScrapSort;
    rank?: ReadonlyMap<string, number> | null;
    now?: number;
  },
): ScrapArchiveOrder {
  const { groupBy, sort, rank } = options;
  const sorted = [...items].sort(
    (first, second) =>
      (rank
        ? (rank.get(second.key) ?? -Infinity) -
            (rank.get(first.key) ?? -Infinity) || 0
        : 0) ||
      (sort === "most-seen"
        ? scrapEncounters(second) - scrapEncounters(first)
        : 0) ||
      second.ts - first.ts ||
      first.key.localeCompare(second.key),
  );
  if (groupBy === "none") return { items: sorted, groupOf: [], groups: [] };

  const members = new Map<string, ScrapItem[]>();
  for (const item of sorted) {
    const key = groupKey(item, groupBy);
    const group = members.get(key);
    if (group) group.push(item);
    else members.set(key, [item]);
  }
  const keys = [...members.keys()];
  if (groupBy === "day")
    keys.sort((first, second) => second.localeCompare(first));

  const now = options.now ?? Date.now();
  const ordered: ScrapItem[] = [];
  const groupOf: number[] = [];
  const groups: ScrapArchiveGroup[] = [];
  keys.forEach((key, index) => {
    const group = members.get(key)!;
    const first = group[0];
    groups.push({
      key,
      label:
        groupBy === "site"
          ? key
          : groupBy === "day"
            ? formatDay(first.ts, now)
            : KIND_LABELS[first.kind],
      count: group.length,
      first,
    });
    for (const item of group) {
      ordered.push(item);
      groupOf.push(index);
    }
  });
  return { items: ordered, groupOf, groups };
}
