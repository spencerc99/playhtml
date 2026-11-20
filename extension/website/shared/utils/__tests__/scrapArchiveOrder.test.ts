// ABOUTME: Verifies the archive's sort (newest, most seen) and grouping (site, day, kind).
// ABOUTME: Also checks that repeat encounters of non-photo scraps fold into one counted scrap.

import { describe, expect, it } from "vitest";
import type { ScrapItem } from "../../components/ScrapCollage";
import { canonicalScrapKey } from "../../components/ScrapCollage";
import { orderScrapArchive, scrapEncounters } from "../scrapArchiveOrder";
import { groupScrapEncounters } from "../scrapPhotoGroups";

const DAY = 86_400_000;
const NOON = new Date(2026, 10, 19, 12).getTime();

function button(
  id: string,
  domain: string,
  ts: number,
  extra: Partial<ScrapItem> = {},
): ScrapItem {
  return {
    id,
    key: id,
    kind: "button",
    text: `Button ${id}`,
    styles: {},
    pageTitle: id,
    domain,
    pageUrl: `https://${domain}/${id}`,
    ts,
    ...extra,
  } as ScrapItem;
}

function heading(id: string, domain: string, ts: number): ScrapItem {
  return {
    id,
    key: id,
    kind: "heading",
    text: `Heading ${id}`,
    level: 1,
    styles: {},
    pageTitle: id,
    domain,
    pageUrl: `https://${domain}/${id}`,
    ts,
  };
}

describe("orderScrapArchive", () => {
  const items = [
    button("a", "a.example", NOON, { encounterCount: 1 }),
    button("b", "b.example", NOON - 1_000, { encounterCount: 5 }),
    heading("c", "a.example", NOON - DAY),
    button("d", "b.example", NOON - 2 * DAY, { encounterCount: 2 }),
  ];

  it("sorts newest first, or most seen first", () => {
    const newest = orderScrapArchive(items, {
      groupBy: "none",
      sort: "newest",
    });
    expect(newest.items.map((item) => item.id)).toEqual(["a", "b", "c", "d"]);
    expect(newest.groupOf).toEqual([]);

    const mostSeen = orderScrapArchive(items, {
      groupBy: "none",
      sort: "most-seen",
    });
    expect(mostSeen.items.map((item) => item.id)).toEqual(["b", "d", "a", "c"]);
  });

  it("groups by site in the order each site's best scrap reached", () => {
    const order = orderScrapArchive(items, {
      groupBy: "site",
      sort: "most-seen",
    });
    expect(order.items.map((item) => item.id)).toEqual(["b", "d", "a", "c"]);
    expect(order.groupOf).toEqual([0, 0, 1, 1]);
    expect(order.groups.map((group) => [group.label, group.count])).toEqual([
      ["b.example", 2],
      ["a.example", 2],
    ]);
  });

  it("groups by day, newest day first, whatever the sort", () => {
    const order = orderScrapArchive(items, {
      groupBy: "day",
      sort: "most-seen",
      now: NOON,
    });
    expect(order.items.map((item) => item.id)).toEqual(["b", "a", "c", "d"]);
    expect(order.groups.map((group) => group.label)).toEqual([
      "Nov 19",
      "Nov 18",
      "Nov 17",
    ]);
  });

  it("groups by kind with plain names", () => {
    const order = orderScrapArchive(items, { groupBy: "kind", sort: "newest" });
    expect(order.groups.map((group) => [group.label, group.count])).toEqual([
      ["buttons", 3],
      ["headings", 1],
    ]);
  });

  it("puts a scored search ahead of the chosen sort", () => {
    const order = orderScrapArchive(items, {
      groupBy: "none",
      sort: "most-seen",
      rank: new Map([["c", 0.9]]),
    });
    expect(order.items[0].id).toBe("c");
  });
});

describe("groupScrapEncounters for scraps that are not photos", () => {
  it("folds one button met on three days into one scrap seen three times", () => {
    const records = [0, 1, 2].map((daysAgo) =>
      button(`r${daysAgo}`, "a.example", NOON - daysAgo * DAY, {
        text: "Subscribe",
        encounterDay: `2026-11-${19 - daysAgo}`,
        pageUrl: `https://a.example/post-${daysAgo}`,
      } as Partial<ScrapItem>),
    );
    const grouped = groupScrapEncounters(records, canonicalScrapKey);

    expect(grouped).toHaveLength(1);
    expect(grouped[0].id).toBe("r0");
    expect(scrapEncounters(grouped[0])).toBe(3);
    expect(
      grouped[0].sources?.flatMap((source) => source.encounterDays),
    ).toEqual(
      expect.arrayContaining(["2026-11-17", "2026-11-18", "2026-11-19"]),
    );
  });

  it("leaves other kinds alone without an identity, and keeps distinct buttons apart", () => {
    const records = [
      button("x", "a.example", NOON, { text: "Sign in" } as Partial<ScrapItem>),
      button("y", "a.example", NOON, { text: "Sign up" } as Partial<ScrapItem>),
    ];
    expect(groupScrapEncounters(records)).toEqual(records);
    expect(groupScrapEncounters(records, canonicalScrapKey)).toHaveLength(2);
  });

  it("counts the same fold twice only once", () => {
    const records = [0, 1].map((daysAgo) =>
      button(`r${daysAgo}`, "a.example", NOON - daysAgo * DAY, {
        text: "Subscribe",
        encounterDay: `2026-11-${19 - daysAgo}`,
      } as Partial<ScrapItem>),
    );
    const once = groupScrapEncounters(records, canonicalScrapKey);
    const twice = groupScrapEncounters(once, canonicalScrapKey);
    expect(scrapEncounters(twice[0])).toBe(2);
  });
});
