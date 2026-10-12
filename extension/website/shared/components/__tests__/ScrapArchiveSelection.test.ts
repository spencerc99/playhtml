// ABOUTME: Verifies the archive marquee picks out exactly the scraps its rectangle touches.
// ABOUTME: Covers rows far outside the rendered window, which a long drag can reach.

import { describe, expect, it } from "vitest";
import {
  archiveKeysInRect,
  buildArchiveWindow,
  type ScrapItem,
} from "../ScrapCollage";

function buildItems(count: number): ScrapItem[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `s${index}`,
    key: `s${index}`,
    kind: "button" as const,
    text: `Scrap ${index}`,
    styles: {},
    pageTitle: `Page ${index}`,
    domain: `d${index}.example`,
    pageUrl: `https://d${index}.example/`,
    ts: index,
  }));
}

function touches(
  scrap: { x: number; y: number; width: number; height: number },
  rect: { x: number; y: number; width: number; height: number },
) {
  return (
    scrap.x < rect.x + rect.width &&
    scrap.x + scrap.width > rect.x &&
    scrap.y < rect.y + rect.height &&
    scrap.y + scrap.height > rect.y
  );
}

describe("archiveKeysInRect", () => {
  it("matches the tiles the archive window draws under the rectangle", () => {
    const items = buildItems(2_000);
    const rect = { x: 120, y: 2_000, width: 300, height: 260 };
    const window = buildArchiveWindow(
      items,
      900,
      1_800,
      600,
      7,
      undefined,
      "pile",
    );
    const expected = window.layout
      .filter((scrap) => touches(scrap, rect))
      .map((scrap) => scrap.item.key)
      .sort();

    const keys = archiveKeysInRect(
      items,
      900,
      600,
      rect,
      7,
      undefined,
      "pile",
    ).sort();

    expect(expected.length).toBeGreaterThan(0);
    expect(keys).toEqual(expected);
  });

  it("reaches rows the rendered window never laid out", () => {
    const items = buildItems(2_000);
    const atTop = buildArchiveWindow(items, 900, 0, 600, 7, undefined, "pile");
    const rect = { x: 0, y: 0, width: 900, height: 5_000 };

    const keys = archiveKeysInRect(items, 900, 600, rect, 7, undefined, "pile");

    expect(keys.length).toBeGreaterThan(atTop.layout.length);
  });

  it("finds nothing in an empty corner of the field", () => {
    const items = buildItems(3);
    expect(
      archiveKeysInRect(
        items,
        900,
        600,
        { x: 0, y: 500, width: 900, height: 100 },
        7,
        undefined,
        "pile",
      ),
    ).toEqual([]);
  });
});
