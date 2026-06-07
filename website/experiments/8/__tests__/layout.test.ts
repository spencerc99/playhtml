// ABOUTME: Verifies grid typing positions for experiment 8.
// ABOUTME: Covers scroll clearance reserved below the last typed row.
import { describe, expect, it } from "vitest";
import {
  getBottomScrollClearancePx,
  getGridCellCount,
  getGridRowHeightPx,
  getGridWidthPx,
  getRemoteTypingCursors,
  getScrollEndY,
  getTrailingCellCount,
  getTypingCursorPosition,
  isScrollAtEnd,
  shouldPublishTypingAwareness,
} from "../layout";

describe("experiment 8 layout", () => {
  it("places the typing cursor after the last typed cell", () => {
    expect(getTypingCursorPosition(0)).toBe(0);
    expect(getTypingCursorPosition(5)).toBe(5);
  });

  it("keeps an empty cell available for the typing cursor", () => {
    expect(getGridCellCount({ letterCount: 5, minimumCellCount: 4 })).toBe(6);
  });

  it("keeps one blank row after the row being typed into", () => {
    expect(getTrailingCellCount({ cursorPosition: 0, columnCount: 10 })).toBe(
      20
    );
    expect(getTrailingCellCount({ cursorPosition: 9, columnCount: 10 })).toBe(
      20
    );
    expect(getTrailingCellCount({ cursorPosition: 10, columnCount: 10 })).toBe(
      30
    );
    expect(
      getGridCellCount({
        letterCount: 10,
        minimumCellCount: 100,
        columnCount: 10,
      })
    ).toBe(30);
  });

  it("reserves the fixed bottom bar height below the grid", () => {
    expect(
      getBottomScrollClearancePx({
        bottomBarHeightPx: 87,
      })
    ).toBe(87);
  });

  it("calculates the page scroll end", () => {
    expect(getScrollEndY({ scrollHeight: 1376, viewportHeight: 993 })).toBe(
      383
    );
    expect(getScrollEndY({ scrollHeight: 800, viewportHeight: 993 })).toBe(0);
  });

  it("detects when the page is pinned to the scroll end", () => {
    expect(
      isScrollAtEnd({
        scrollY: 382.5,
        scrollHeight: 1376,
        viewportHeight: 993,
      })
    ).toBe(true);
    expect(
      isScrollAtEnd({
        scrollY: 300,
        scrollHeight: 1376,
        viewportHeight: 993,
      })
    ).toBe(false);
  });

  it("matches grid width to complete cell columns", () => {
    expect(getGridWidthPx({ columnCount: 19, cellSizePx: 32 })).toBe(608);
  });

  it("matches grid row height to the cell size", () => {
    expect(getGridRowHeightPx({ cellSizePx: 32 })).toBe(32);
  });

  it("excludes the local cursor from remote typing cursors", () => {
    const myCursor = { color: "purple", cursorPos: 5 };

    expect(
      getRemoteTypingCursors({
        awareness: [
          myCursor,
          { color: "orange", cursorPos: 8 },
          { color: "broken" },
        ],
        myAwareness: myCursor,
      })
    ).toEqual([{ color: "orange", cursorPos: 8 }]);
  });

  it("publishes typing awareness only when it changes", () => {
    const current = { color: "purple", cursorPos: 5 };

    expect(
      shouldPublishTypingAwareness({
        current,
        next: { color: "purple", cursorPos: 5 },
      })
    ).toBe(false);
    expect(
      shouldPublishTypingAwareness({
        current,
        next: { color: "purple", cursorPos: 6 },
      })
    ).toBe(true);
  });
});
