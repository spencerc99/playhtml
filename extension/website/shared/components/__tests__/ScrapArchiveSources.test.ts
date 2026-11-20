// ABOUTME: Verifies how the archive outlines its groups of scraps row by row.
// ABOUTME: Covers wrapped rows, labels on the first stretch only, and distinct inks.

import { describe, expect, it } from "vitest";
import { buildArchiveSources, type ScrapItem } from "../ScrapCollage";

function scrap(index: number, domain: string, page = "/"): ScrapItem {
  return {
    id: `s${index}`,
    key: `s${index}`,
    kind: "button",
    text: `Scrap ${index}`,
    styles: {},
    pageTitle: `Page ${index}`,
    domain,
    pageUrl: `https://${domain}${page}`,
    ts: 1_000 - index,
  };
}

/** Each run of one site is a group, the way grouping by site lays them out. */
function archiveVisits(items: readonly ScrapItem[]): number[] {
  let group = -1;
  return items.map((item, index) => {
    if (index === 0 || items[index - 1].domain !== item.domain) group += 1;
    return group;
  });
}

describe("buildArchiveSources", () => {
  // The pile's archive cell is 76 wide, so 380px holds five columns a row.
  const width = 380;

  it("gives a visit one stretch per row and labels only the first", () => {
    const items = [
      scrap(0, "a.example"),
      ...Array.from({ length: 7 }, (_, index) => scrap(index + 1, "b.example")),
    ];
    const visits = archiveVisits(items);
    const marks = buildArchiveSources(items, visits, width, 0, items.length - 1, "pile");

    expect(marks.map((mark) => [mark.x, mark.y, mark.width])).toEqual([
      [0, 0, 76],
      [76, 0, 304],
      [0, 74, 228],
    ]);
    expect(marks.map((mark) => mark.labelFor?.key ?? null)).toEqual([
      "s0",
      "s1",
      null,
    ]);
    expect(marks[1].continuesBelow).toBe(true);
    expect(marks[2].continuesAbove).toBe(true);
    expect(marks[0].continuesBelow).toBe(false);
  });

  it("keeps a visit that wraps far right to far left as two named outlines", () => {
    const items = [
      ...Array.from({ length: 4 }, (_, index) => scrap(index, "a.example")),
      ...Array.from({ length: 3 }, (_, index) => scrap(index + 4, "b.example")),
    ];
    const marks = buildArchiveSources(items, archiveVisits(items), width, 0, 6, "pile");
    const wrapped = marks.filter((mark) => mark.labelFor?.domain === "b.example");

    expect(wrapped).toHaveLength(2);
    expect(wrapped.map((mark) => [mark.continuesAbove, mark.continuesBelow])).toEqual([
      [false, false],
      [false, false],
    ]);
    expect(wrapped.map((mark) => mark.labelRepeats)).toEqual([false, true]);
  });

  it("inks neighbouring visits differently", () => {
    const items = [scrap(0, "a.example"), scrap(1, "b.example"), scrap(2, "c.example")];
    const marks = buildArchiveSources(items, archiveVisits(items), width, 0, 2, "pile");
    expect(new Set(marks.map((mark) => mark.tint)).size).toBe(3);
  });

  it("leaves a later window's first stretch unlabelled when its visit began earlier", () => {
    const items = Array.from({ length: 12 }, (_, index) => scrap(index, "a.example"));
    const marks = buildArchiveSources(items, archiveVisits(items), width, 5, 11, "pile");
    expect(marks[0].labelFor).toBeNull();
    expect(marks[0].continuesAbove).toBe(true);
  });
});
