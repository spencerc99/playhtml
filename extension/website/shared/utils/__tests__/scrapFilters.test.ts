// ABOUTME: Verifies source-aware filtering without dropping photo encounter history.
// ABOUTME: Covers domain/path scopes, saved-text search, and local day / time-of-day sightings.
import { describe, expect, it } from "vitest";
import type { ScrapItem } from "../../components/ScrapCollage";
import { groupPhotoEncounters } from "../scrapPhotoGroups";
import { parseFilterChip } from "../eventUtils";
import {
  ANY_TIME,
  matchesScrapFilters,
  matchesScrapWhen,
  scrapDays,
} from "../scrapFilters";

const photo: ScrapItem = {
  id: "a",
  key: "a",
  kind: "image",
  src: "https://cdn.test/a.png",
  pageTitle: "Garden",
  pageUrl: "https://are.na/spencer/garden",
  domain: "are.na",
  ts: 1,
  alt: "Green leaves",
  naturalWidth: 100,
  naturalHeight: 100,
};
const grouped = groupPhotoEncounters([
  photo,
  {
    ...photo,
    id: "b",
    key: "b",
    pageTitle: "Botanical notes",
    pageUrl: "https://spencer.place/notes",
    domain: "spencer.place",
    ts: 2,
  },
])[0];
describe("scrap filters", () => {
  it("matches any photo source and preserves all encounters", () => {
    expect(
      matchesScrapFilters(
        grouped,
        [parseFilterChip("are.na/spencer")],
        "garden",
      ),
    ).toBe(true);
    expect(grouped.sources).toHaveLength(2);
    expect(
      matchesScrapFilters(grouped, [parseFilterChip("are.na/other")], ""),
    ).toBe(false);
    expect(
      matchesScrapFilters(grouped, [parseFilterChip("not-are.na")], ""),
    ).toBe(false);
  });
  it("combines domain choices with OR and search with AND", () => {
    const places = [
      parseFilterChip("example.com"),
      parseFilterChip("spencer.place"),
    ];
    expect(matchesScrapFilters(grouped, places, "BOTANICAL leaves")).toBe(true);
    expect(matchesScrapFilters(grouped, places, "missing")).toBe(false);
    expect(matchesScrapFilters(grouped, [], "  ")).toBe(true);
  });
  it("searches button text and URLs", () => {
    const button: ScrapItem = {
      ...photo,
      kind: "button",
      text: "Save for later",
      styles: {},
    };
    expect(matchesScrapFilters(button, [], "later spencer")).toBe(true);
  });
});

describe("scrap day and time-of-day filters", () => {
  const at = (day: number, hour: number, minute = 0) =>
    new Date(2026, 8, day, hour, minute).getTime();
  const seenTwice = groupPhotoEncounters([
    { ...photo, ts: at(1, 9) },
    {
      ...photo,
      id: "b",
      key: "b",
      pageUrl: "https://spencer.place/notes",
      domain: "spencer.place",
      ts: at(3, 22, 30),
    },
  ])[0];
  const morning = { centerMinutes: 540, radiusMinutes: 180 };
  const lateNight = { centerMinutes: 1380, radiusMinutes: 90 };

  it("matches a photo on any day it was seen, in local time", () => {
    expect(matchesScrapWhen(seenTwice, ANY_TIME)).toBe(true);
    expect(matchesScrapWhen(seenTwice, { day: "2026-09-01", timeOfDay: null })).toBe(true);
    expect(matchesScrapWhen(seenTwice, { day: "2026-09-02", timeOfDay: null })).toBe(false);
    expect(matchesScrapWhen(seenTwice, { day: "2026-09-03", timeOfDay: null })).toBe(true);
  });

  it("needs one sighting to fall on both the day and the time of day", () => {
    expect(matchesScrapWhen(seenTwice, { day: null, timeOfDay: morning })).toBe(true);
    expect(
      matchesScrapWhen(seenTwice, { day: "2026-09-03", timeOfDay: morning }),
    ).toBe(false);
    expect(
      matchesScrapWhen(seenTwice, { day: "2026-09-03", timeOfDay: lateNight }),
    ).toBe(true);
  });

  it("falls back to when a single scrap was first kept", () => {
    const button: ScrapItem = {
      ...photo,
      kind: "button",
      text: "Save",
      styles: {},
      ts: at(5, 0, 20),
    };
    const midnight = { centerMinutes: 0, radiusMinutes: 30 };
    expect(matchesScrapWhen(button, { day: "2026-09-05", timeOfDay: midnight })).toBe(true);
    expect(matchesScrapWhen(button, { day: "2026-09-04", timeOfDay: null })).toBe(false);
  });

  it("lists the days a scrap was seen, limited by the time of day", () => {
    expect([...scrapDays(seenTwice, null)].sort()).toEqual([
      "2026-09-01",
      "2026-09-03",
    ]);
    expect([...scrapDays(seenTwice, morning)]).toEqual(["2026-09-01"]);
  });
});
