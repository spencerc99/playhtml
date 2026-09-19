// ABOUTME: Verifies cursor distance follows continuous movement on one normalized page.
// ABOUTME: Guards viewport scaling, sample gaps, and invalid cursor coordinates.

import { describe, expect, it } from "vitest";
import type { CollectionEvent } from "@playhtml/extension-types";
import { calculateCursorDistance } from "./cursorDistance";

function cursorMove(
  id: string,
  ts: number,
  url: string,
  x: number,
  y: number,
  viewport = { width: 1_000, height: 800 },
): CollectionEvent {
  return {
    id,
    type: "cursor",
    ts,
    data: { event: "move", x, y },
    meta: {
      pid: "pk_test",
      sid: "sid_test",
      url,
      vw: viewport.width,
      vh: viewport.height,
      tz: "America/Los_Angeles",
    },
  };
}

describe("calculateCursorDistance", () => {
  it("does not connect cursor samples from different normalized URLs", () => {
    const distance = calculateCursorDistance([
      cursorMove("first-page", 1_000, "https://example.com/first", 0, 0),
      cursorMove("second-page", 2_000, "https://example.com/second", 1, 1),
    ]);

    expect(distance).toBe(0);
  });

  it("uses recorded viewport dimensions for nearby samples on the same page", () => {
    const distance = calculateCursorDistance([
      cursorMove(
        "first",
        1_000,
        "https://example.com/Page?first=true",
        0,
        0,
      ),
      cursorMove(
        "second",
        2_000,
        "http://example.com/page#section",
        0.3,
        0.8,
        { width: 1_000, height: 500 },
      ),
    ]);

    expect(distance).toBe(500);
  });

  it("does not connect stale or non-finite samples", () => {
    const distance = calculateCursorDistance([
      cursorMove("first", 1_000, "https://example.com/page", 0, 0),
      cursorMove("stale", 7_000, "https://example.com/page", 1, 1),
      cursorMove(
        "invalid",
        8_000,
        "https://example.com/page",
        Number.NaN,
        0.5,
      ),
    ]);

    expect(distance).toBe(0);
  });
});
