// ABOUTME: Tests how the scrap drawer places natural-aspect thumbnails in columns.
// ABOUTME: Pure layout, so the windowing and the aspects are checked without a browser.

import { describe, expect, it } from "vitest";
import type { ScrapItem } from "@movement/components/ScrapCollage";
import {
  CELL_GAP,
  cellLeft,
  layOutDrawer,
  thumbnailHeight,
  visibleCells,
} from "../entrypoints/scraps/drawerLayout";
import {
  backingForKind,
  couldBeTransparent,
} from "../entrypoints/scraps/scrapTransparency";

const base = {
  key: "k",
  pageTitle: "A page",
  domain: "example.test",
  pageUrl: "https://example.test/a",
  ts: 0,
};

function picture(
  id: string,
  naturalWidth: number,
  naturalHeight: number,
): ScrapItem {
  return {
    ...base,
    id,
    kind: "image",
    src: `https://example.test/${id}.png`,
    naturalWidth,
    naturalHeight,
  } as ScrapItem;
}

const icon = (id: string, width = 24, height = 24): ScrapItem =>
  ({ ...base, id, kind: "svg-icon", markup: "<svg/>", width, height }) as ScrapItem;
const button = (id: string): ScrapItem =>
  ({ ...base, id, kind: "button", text: "Go", styles: {} }) as ScrapItem;
const cursor = (id: string): ScrapItem =>
  ({ ...base, id, kind: "cursor", url: "https://example.test/c.svg" }) as ScrapItem;

describe("how tall a thumbnail wants to be", () => {
  it("keeps a picture's own proportions", () => {
    // A 2:1 picture in a 100-wide column is 50 tall.
    expect(thumbnailHeight(picture("a", 600, 300), 100)).toBeCloseTo(50);
    expect(thumbnailHeight(picture("b", 300, 600), 100)).toBeCloseTo(200);
  });

  it("gives a picture with no recorded size a square", () => {
    expect(thumbnailHeight(picture("c", 0, 0), 100)).toBe(100);
    expect(
      thumbnailHeight(picture("d", Number.NaN, 120), 100),
    ).toBe(100);
  });

  it("shows a small thing in a small box, not blown up the column", () => {
    const tall = thumbnailHeight(icon("e", 24, 24), 400);
    expect(tall).toBeLessThan(400);
    expect(tall).toBeGreaterThan(0);
  });

  it("keeps an icon's aspect inside that box", () => {
    // A 2:1 icon stays 2:1 rather than becoming a square.
    const wide = thumbnailHeight(icon("f", 48, 24), 400);
    const square = thumbnailHeight(icon("g", 24, 24), 400);
    expect(wide).toBeCloseTo(square / 2);
  });

  it("gives a button a short wide box and a cursor a small one", () => {
    expect(thumbnailHeight(button("h"), 200)).toBeLessThan(100);
    expect(thumbnailHeight(cursor("i"), 400)).toBeLessThanOrEqual(72);
  });
});

describe("placing the drawer's columns", () => {
  const items = [
    picture("1", 100, 100),
    picture("2", 100, 200),
    picture("3", 100, 50),
    picture("4", 100, 100),
  ];

  it("puts every scrap somewhere, once", () => {
    const layout = layOutDrawer(items, 300, 3);
    expect(layout.cells).toHaveLength(4);
    expect(layout.cells.map((cell) => cell.item.id).sort()).toEqual([
      "1",
      "2",
      "3",
      "4",
    ]);
  });

  it("fills the columns it is given", () => {
    const layout = layOutDrawer(items, 300, 3);
    expect(new Set(layout.cells.slice(0, 3).map((c) => c.column)).size).toBe(3);
  });

  it("gives the next scrap to the shortest column", () => {
    const layout = layOutDrawer(items, 300, 3);
    // The fourth goes under the shortest of the first three, which is the
    // 50-tall one in column 2.
    expect(layout.cells[3].column).toBe(2);
  });

  it("never overlaps two cells in the same column", () => {
    const layout = layOutDrawer(items, 300, 3);
    for (let column = 0; column < 3; column += 1) {
      const inColumn = layout.cells
        .filter((cell) => cell.column === column)
        .sort((a, b) => a.top - b.top);
      for (let index = 1; index < inColumn.length; index += 1) {
        const above = inColumn[index - 1];
        expect(inColumn[index].top).toBeGreaterThanOrEqual(
          above.top + above.height,
        );
      }
    }
  });

  it("is as tall as its tallest column", () => {
    const layout = layOutDrawer(items, 300, 3);
    expect(layout.height).toBe(Math.max(...layout.columnHeights));
    for (const cell of layout.cells) {
      expect(cell.top + cell.height).toBeLessThanOrEqual(layout.height);
    }
  });

  it("keeps each cell's height at its own aspect", () => {
    const layout = layOutDrawer([picture("x", 200, 100)], 300, 1);
    const cell = layout.cells[0];
    // One column, so the cell is the column's width at a 2:1 aspect.
    expect(cell.height).toBe(Math.round(layout.columnWidth / 2));
  });

  it("lays columns out side by side without overlapping", () => {
    const layout = layOutDrawer(items, 300, 3);
    for (const cell of layout.cells) {
      const left = cellLeft(cell, layout.columnWidth);
      expect(left).toBeGreaterThanOrEqual(CELL_GAP);
      expect(left + layout.columnWidth).toBeLessThanOrEqual(300);
    }
  });

  it("survives a column count below one", () => {
    const layout = layOutDrawer(items, 300, 0);
    expect(layout.cells).toHaveLength(4);
    expect(layout.cells.every((cell) => cell.column === 0)).toBe(true);
  });

  it("has nothing to place for an empty drawer", () => {
    const layout = layOutDrawer([], 300, 3);
    expect(layout.cells).toEqual([]);
    expect(layout.height).toBe(CELL_GAP);
  });
});

describe("only mounting what is in view", () => {
  // A thousand tall pictures, so the runway is far longer than any viewport.
  const many = Array.from({ length: 1000 }, (_, index) =>
    picture(`p${index}`, 100, 100),
  );
  const layout = layOutDrawer(many, 300, 3);

  it("keeps the mounted count bounded however long the list is", () => {
    const visible = visibleCells(layout, 0, 800, 400);
    expect(visible.length).toBeLessThan(100);
    expect(visible.length).toBeGreaterThan(0);
  });

  it("stays bounded scrolled deep into the list", () => {
    const deep = visibleCells(layout, layout.height / 2, 800, 400);
    expect(deep.length).toBeLessThan(100);
    expect(deep.length).toBeGreaterThan(0);
  });

  it("includes a cell straddling the top of the view", () => {
    const first = layout.cells[0];
    const visible = visibleCells(layout, first.height - 1, 800, 0);
    expect(visible).toContain(first);
  });

  it("leaves out what is far above or below", () => {
    const visible = visibleCells(layout, 0, 200, 0);
    expect(visible.some((cell) => cell.top > 10_000)).toBe(false);
  });
});

describe("what goes behind a thumbnail", () => {
  it("always backs the kinds that are cut-outs by nature", () => {
    expect(backingForKind(icon("a"))).toBe("checker");
    expect(backingForKind(cursor("b"))).toBe("checker");
  });

  it("puts a button on the paper", () => {
    expect(backingForKind(button("c"))).toBe("paper");
  });

  it("leaves a picture to be decided by its own pixels", () => {
    expect(backingForKind(picture("d", 10, 10))).toBeNull();
  });

  it("only samples formats that can carry alpha", () => {
    expect(couldBeTransparent("https://e.test/a.png")).toBe(true);
    expect(couldBeTransparent("https://e.test/a.webp?v=2")).toBe(true);
    expect(couldBeTransparent("https://e.test/a.svg#icon")).toBe(true);
    expect(couldBeTransparent("https://e.test/a.gif")).toBe(true);
    expect(couldBeTransparent("https://e.test/a.jpg")).toBe(false);
    expect(couldBeTransparent("https://e.test/a.jpeg")).toBe(false);
    expect(couldBeTransparent("")).toBe(false);
  });

  it("reads a data URL's own type", () => {
    expect(couldBeTransparent("data:image/png;base64,AAAA")).toBe(true);
    expect(couldBeTransparent("data:image/jpeg;base64,AAAA")).toBe(false);
  });
});
