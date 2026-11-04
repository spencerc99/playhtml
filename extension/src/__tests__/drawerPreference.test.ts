// ABOUTME: Checks how the scrap drawer turns its width into columns.
// ABOUTME: The columns fill the drawer and stay near one target width.

import { describe, expect, it } from "vitest";
import {
  DRAWER_COLUMN_TARGET,
  defaultDrawerWidth,
  drawerColumns,
} from "../entrypoints/scraps/drawerPreference";

describe("drawerColumns", () => {
  it("shows three columns at the default width", () => {
    expect(drawerColumns(defaultDrawerWidth())).toBe(3);
  });

  it("rounds to the nearest count so columns stay near the target", () => {
    for (let width = 2 * DRAWER_COLUMN_TARGET; width <= 1200; width += 7) {
      const columnWidth = width / drawerColumns(width);
      expect(columnWidth).toBeGreaterThanOrEqual(DRAWER_COLUMN_TARGET * 0.75);
      expect(columnWidth).toBeLessThan(DRAWER_COLUMN_TARGET * 1.25);
    }
  });

  it("never drops below one column", () => {
    expect(drawerColumns(20)).toBe(1);
  });
});
