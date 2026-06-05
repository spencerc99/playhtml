// ABOUTME: Tests for guestbook card pile and visitor dot data selection.
// ABOUTME: Verifies visitor dots can cover the full guestbook without rendering every card.

import { describe, expect, it } from "vitest";
import {
  getGuestbookDotColors,
  getLoopedEntryIndex,
  getRenderedPileCardIndexes,
} from "../auraGuestbookData";

function entry(color: string, timestamp: number) {
  return {
    name: `person-${timestamp}`,
    color,
    message: `message ${timestamp}`,
    timestamp,
  };
}

describe("getGuestbookDotColors", () => {
  it("returns every unique visitor color newest first", () => {
    const entries = Array.from({ length: 123 }, (_, index) =>
      entry(`hsl(${index}, 60%, 50%)`, index),
    );

    const colors = getGuestbookDotColors(entries);

    expect(colors).toHaveLength(123);
    expect(colors.slice(0, 3)).toEqual([
      "hsl(122, 60%, 50%)",
      "hsl(121, 60%, 50%)",
      "hsl(120, 60%, 50%)",
    ]);
    expect(colors.slice(-3)).toEqual([
      "hsl(2, 60%, 50%)",
      "hsl(1, 60%, 50%)",
      "hsl(0, 60%, 50%)",
    ]);
  });

  it("deduplicates repeated colors by the newest visit", () => {
    const entries = [
      entry("#c4724e", 1),
      entry("#4a9a8a", 2),
      entry("#c4724e", 3),
    ];

    expect(getGuestbookDotColors(entries)).toEqual(["#c4724e", "#4a9a8a"]);
  });
});

describe("getRenderedPileCardIndexes", () => {
  it("keeps the resting pile capped to the newest cards", () => {
    const entries = Array.from({ length: 5 }, (_, index) =>
      entry(`#color-${index}`, index),
    );

    expect(getRenderedPileCardIndexes(entries, 3, null)).toEqual([2, 3, 4]);
  });

  it("adds a buried card when its visitor dot is hovered", () => {
    const entries = Array.from({ length: 5 }, (_, index) =>
      entry(`#color-${index}`, index),
    );

    expect(getRenderedPileCardIndexes(entries, 3, "#color-0")).toEqual([
      2,
      3,
      4,
      0,
    ]);
  });

  it("does not duplicate a card that is already in the rendered pile", () => {
    const entries = Array.from({ length: 5 }, (_, index) =>
      entry(`#color-${index}`, index),
    );

    expect(getRenderedPileCardIndexes(entries, 3, "#color-4")).toEqual([
      2,
      3,
      4,
    ]);
  });

  it("does not render a card for a dot color without an entry", () => {
    const entries = Array.from({ length: 5 }, (_, index) =>
      entry(`#color-${index}`, index),
    );

    expect(getRenderedPileCardIndexes(entries, 3, "#mock-color")).toEqual([
      2,
      3,
      4,
    ]);
  });
});

describe("getLoopedEntryIndex", () => {
  it("wraps forward from the last entry to the first", () => {
    expect(getLoopedEntryIndex(2, 3, 1)).toBe(0);
  });

  it("wraps backward from the first entry to the last", () => {
    expect(getLoopedEntryIndex(0, 3, -1)).toBe(2);
  });

  it("keeps the current index when there are no entries", () => {
    expect(getLoopedEntryIndex(0, 0, 1)).toBe(0);
  });
});
