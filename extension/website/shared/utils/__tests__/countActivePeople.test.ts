// ABOUTME: Tests counting distinct recently-active people from the raw event
// ABOUTME: stream, independent of how many trails the canvas actually draws.

import { describe, it, expect } from "vitest";
import { countActivePeople } from "../eventUtils";
import type { CollectionEvent } from "../../types";

function ev(pid: string, ts: number): CollectionEvent {
  return {
    id: `${pid}-${ts}`,
    type: "cursor",
    ts,
    data: { x: 0.5, y: 0.5 },
    meta: { pid, sid: "s", url: "u", vw: 1, vh: 1, tz: "UTC" },
  } as CollectionEvent;
}

const NOW = 1_000_000;
const WINDOW = 45_000;

describe("countActivePeople", () => {
  it("counts distinct pids within the window", () => {
    expect(
      countActivePeople(
        [ev("a", NOW), ev("b", NOW), ev("a", NOW)],
        WINDOW,
        NOW,
      ),
    ).toBe(2);
  });

  it("ignores people whose last event is outside the window", () => {
    const events = [
      ev("recent", NOW - 1_000), // 1s ago — kept
      ev("stale", NOW - 60_000), // 60s ago, window is 45s — dropped
    ];
    expect(countActivePeople(events, WINDOW, NOW)).toBe(1);
  });

  it("is anchored to `now`, NOT the newest event (skew-proof)", () => {
    // Regression: a single client with a fast clock sends a future-dated event.
    // The window must stay anchored to `now`, so the future event doesn't shift
    // the window forward and drop everyone else to zero.
    const events = [
      ev("realA", NOW - 5_000),
      ev("realB", NOW - 10_000),
      ev("skewedFast", NOW + 90_000), // 90s in the future
    ];
    // All three count: realA/realB are recent; the future one is clamped to now.
    expect(countActivePeople(events, WINDOW, NOW)).toBe(3);
  });

  it("a future-dated event does not hide everyone else", () => {
    // The exact production bug: one +76s event made the count read 1.
    const events = [
      ...Array.from({ length: 20 }, (_, i) => ev(`p${i}`, NOW - 10_000)),
      ev("skewed", NOW + 76_000),
    ];
    expect(countActivePeople(events, WINDOW, NOW)).toBe(21);
  });

  it("returns 0 for no events", () => {
    expect(countActivePeople([])).toBe(0);
  });

  it("is not capped by trail-render limits — counts all active pids", () => {
    const events = Array.from({ length: 100 }, (_, i) => ev(`p${i}`, NOW));
    expect(countActivePeople(events, WINDOW, NOW)).toBe(100);
  });
});
