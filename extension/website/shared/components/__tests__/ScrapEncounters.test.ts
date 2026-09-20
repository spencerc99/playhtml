// ABOUTME: Verifies photo grouping preserves distinct source-page encounters.
// ABOUTME: Covers exact fingerprints, URL fallback, repeated sources, and collection ordering.

import { describe, expect, it } from "vitest";
import { curateScraps, type ScrapItem } from "../ScrapCollage";

function photo(
  id: string,
  src: string,
  pageUrl: string,
  ts: number,
  contentHash?: string,
): ScrapItem {
  return {
    id,
    key: src,
    kind: "image",
    src,
    pageUrl,
    ts,
    contentHash,
    domain: new URL(pageUrl).hostname,
    pageTitle: id,
    naturalWidth: 600,
    naturalHeight: 400,
  };
}

// contentHash is carried only by the image variant of ScrapItem.
function imageContentHash(item: ScrapItem | undefined): string | undefined {
  return item?.kind === "image" ? item.contentHash : undefined;
}

const options = { seed: 1, targetCount: 100, perDomainCap: 100 };

describe("photo encounters", () => {
  it("groups exact copies while retaining every distinct source page", () => {
    const photos = [
      photo(
        "first",
        "https://images.example/a",
        "https://example.com/one",
        1,
        "a".repeat(64),
      ),
      photo(
        "second",
        "https://images.example/b",
        "https://other.example/two",
        2,
        "a".repeat(64),
      ),
      photo(
        "repeat",
        "https://images.example/b",
        "https://other.example/two#section",
        3,
        "a".repeat(64),
      ),
    ];
    const grouped = curateScraps(photos, options);
    expect(grouped).toHaveLength(1);
    expect(grouped[0].sources?.map((source) => source.pageTitle)).toEqual([
      "repeat",
      "first",
    ]);
    expect(photos[0]).not.toHaveProperty("sources");
  });

  it("keeps unchecked encounters separate from fingerprints even at a known URL", () => {
    const grouped = curateScraps(
      [
        photo(
          "checked",
          "https://images.example/a",
          "https://example.com/?id=1",
          1,
          "a".repeat(64),
        ),
        photo(
          "unchecked",
          "https://images.example/a",
          "https://example.com/?id=2",
          2,
        ),
        photo(
          "different",
          "https://images.example/b",
          "https://example.com/?id=3",
          3,
          "b".repeat(64),
        ),
      ],
      options,
    );
    expect(grouped).toHaveLength(3);
    expect(
      imageContentHash(grouped.find((item) => item.id === "unchecked")),
    ).toBeUndefined();
    expect(
      grouped.find((item) => item.id === "unchecked")?.sources,
    ).toHaveLength(1);
  });
  it("counts distinct days per place without double-counting copies or regrouping", () => {
    const hash = "a".repeat(64);
    const samePage = "https://example.com/one";
    const grouped = curateScraps(
      [
        photo(
          "first",
          "https://images.example/a",
          samePage,
          Date.parse("2026-09-16T10:00:00Z"),
          hash,
        ),
        photo(
          "copy",
          "https://images.example/b",
          samePage,
          Date.parse("2026-09-16T11:00:00Z"),
          hash,
        ),
        photo(
          "next-day",
          "https://images.example/a",
          samePage,
          Date.parse("2026-09-17T10:00:00Z"),
          hash,
        ),
        photo(
          "elsewhere",
          "https://images.example/a",
          "https://other.example/two",
          Date.parse("2026-09-16T10:00:00Z"),
          hash,
        ),
      ],
      options,
    );
    expect(grouped[0].encounterCount).toBe(3);
    expect(grouped[0].sources?.[0].encounters.map(({ ts }) => ts)).toEqual([
      Date.parse("2026-09-17T10:00:00Z"),
      Date.parse("2026-09-16T11:00:00Z"),
    ]);
    expect(grouped[0].sources?.map((source) => source.encounterCount)).toEqual([
      2, 1,
    ]);
    expect(curateScraps(grouped, options)).toEqual(grouped);
  });
  it("uses captured local days rather than the viewer's date", () => {
    const first = photo(
      "before-midnight",
      "https://images.example/a",
      "https://example.com/page",
      Date.parse("2026-09-17T06:59:00Z"),
    );
    const second = photo(
      "after-midnight",
      "https://images.example/a",
      "https://example.com/page",
      Date.parse("2026-09-17T07:01:00Z"),
    );
    const [grouped] = curateScraps(
      [
        { ...first, encounterDay: "2026-09-16" },
        { ...second, encounterDay: "2026-09-17" },
      ],
      options,
    );
    expect(grouped.encounterCount).toBe(2);
    expect(grouped.sources).toHaveLength(1);
    expect(grouped.sources?.[0].encounterDays).toEqual([
      "2026-09-16",
      "2026-09-17",
    ]);
  });
});
