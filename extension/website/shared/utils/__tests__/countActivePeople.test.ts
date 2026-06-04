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

describe("countActivePeople", () => {
  it("counts distinct pids", () => {
    const now = 1_000_000;
    expect(
      countActivePeople([ev("a", now), ev("b", now), ev("a", now)]),
    ).toBe(2);
  });

  it("ignores people whose last event is outside the window", () => {
    const now = 1_000_000;
    const events = [
      ev("recent", now),
      ev("stale", now - 60_000), // > 45s window relative to newest
    ];
    expect(countActivePeople(events, 45_000)).toBe(1);
  });

  it("is relative to the newest event, not wall-clock", () => {
    // All events are 'old' in absolute terms but clustered together.
    const base = 0;
    const events = [ev("a", base), ev("b", base + 1000)];
    expect(countActivePeople(events, 45_000)).toBe(2);
  });

  it("returns 0 for no events", () => {
    expect(countActivePeople([])).toBe(0);
  });

  it("is not capped by trail-render limits — counts all active pids", () => {
    const now = 1_000_000;
    const events = Array.from({ length: 100 }, (_, i) => ev(`p${i}`, now));
    expect(countActivePeople(events)).toBe(100);
  });
});
