// ABOUTME: Verifies how the drifting pile spreads its slots across the field.
// ABOUTME: Every slot gets a cell, rows stay even, and each row spans the full width.

import { describe, expect, it } from "vitest";
import { shoreCells } from "../ScrapCollage";

describe("shoreCells", () => {
  it("gives every slot a cell with no leftover cells in the last row", () => {
    const cells = shoreCells(30, 720, 300);
    expect(cells).toHaveLength(30);

    const rows = new Map<number, number[]>();
    for (const cell of cells) {
      rows.set(cell.y, [...(rows.get(cell.y) ?? []), cell.x]);
    }
    const counts = [...rows.values()].map((xs) => xs.length);
    expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1);

    // Each row reaches as close to both edges as every other row.
    for (const xs of rows.values()) {
      const cellWidth = 720 / xs.length;
      expect(Math.min(...xs)).toBeCloseTo(cellWidth / 2);
      expect(Math.max(...xs)).toBeCloseTo(720 - cellWidth / 2);
    }
  });

  it("uses a single row for a wide field with few slots", () => {
    const cells = shoreCells(3, 900, 200);
    expect(cells.map((cell) => cell.x)).toEqual([150, 450, 750]);
    expect(new Set(cells.map((cell) => cell.y))).toEqual(new Set([100]));
  });

  it("returns nothing for an empty or unmeasured field", () => {
    expect(shoreCells(0, 720, 300)).toEqual([]);
    expect(shoreCells(10, 0, 300)).toEqual([]);
  });
});
