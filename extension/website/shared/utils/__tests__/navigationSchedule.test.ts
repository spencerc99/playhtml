// ABOUTME: Locks the mapping from navigation moments to playback offsets
// ABOUTME: including loop wrap, url-change inference, and dedupe against real events

import { describe, it, expect } from "vitest";
import {
  buildNavigationSchedule,
  navigationsCrossed,
} from "../navigationSchedule";
import { CollectionEvent } from "../../types";

const BASE = 1_000_000;

function event(
  type: string,
  ts: number,
  pid: string,
  url: string,
): CollectionEvent {
  return {
    id: `${type}-${pid}-${ts}`,
    type,
    ts,
    data: { x: 0, y: 0 },
    normalizedUrl: url,
    meta: { pid, sid: "s", url, vw: 100, vh: 100, tz: "UTC" },
  };
}

describe("buildNavigationSchedule", () => {
  it("places navigation events at their offset from the range start", () => {
    const schedule = buildNavigationSchedule(
      [
        event("navigation", BASE + 5000, "a", "x.com"),
        event("navigation", BASE, "a", "y.com"),
      ],
      BASE,
      60000,
    );

    expect(schedule.map((n) => n.atMs)).toEqual([0, 5000]);
  });

  it("drops moments outside the playback cycle", () => {
    const schedule = buildNavigationSchedule(
      [
        event("navigation", BASE - 1000, "a", "x.com"),
        event("navigation", BASE + 1000, "a", "y.com"),
        event("navigation", BASE + 90000, "a", "z.com"),
      ],
      BASE,
      60000,
    );

    expect(schedule.map((n) => n.atMs)).toEqual([1000]);
  });

  it("derives its own basis when no other viz has set the range", () => {
    // Navigation-only views leave timeRange.min at 0. The moments must still
    // land inside the cycle in their real relative rhythm.
    const schedule = buildNavigationSchedule(
      [
        event("navigation", BASE, "a", "x.com"),
        event("navigation", BASE + 30000, "a", "y.com"),
        event("navigation", BASE + 60000, "a", "z.com"),
      ],
      0,
      10000,
    );

    expect(schedule).toHaveLength(3);
    expect(schedule[0].atMs).toBe(0);
    // Evenly spaced in, evenly spaced out.
    expect(schedule[1].atMs).toBeCloseTo(4750, 0);
    expect(schedule[2].atMs).toBeCloseTo(9500, 0);
    for (const nav of schedule) {
      expect(nav.atMs).toBeLessThan(10000);
    }
  });

  it("places a lone moment at the start when there is no span", () => {
    const schedule = buildNavigationSchedule(
      [event("navigation", BASE, "a", "x.com")],
      0,
      10000,
    );

    expect(schedule.map((n) => n.atMs)).toEqual([0]);
  });

  it("infers a hop when one person's cursor events change page", () => {
    const schedule = buildNavigationSchedule(
      [
        event("cursor", BASE + 100, "a", "x.com"),
        event("cursor", BASE + 200, "a", "x.com"),
        event("cursor", BASE + 4000, "a", "y.com"),
      ],
      BASE,
      60000,
    );

    expect(schedule.map((n) => n.atMs)).toEqual([4000]);
  });

  it("does not infer a hop across different people on different pages", () => {
    const schedule = buildNavigationSchedule(
      [
        event("cursor", BASE + 100, "a", "x.com"),
        event("cursor", BASE + 200, "b", "y.com"),
      ],
      BASE,
      60000,
    );

    expect(schedule).toHaveLength(0);
  });

  it("dedupes an inferred hop against a real navigation nearby", () => {
    const schedule = buildNavigationSchedule(
      [
        event("cursor", BASE + 1000, "a", "x.com"),
        event("navigation", BASE + 2000, "a", "y.com"),
        event("cursor", BASE + 2100, "a", "y.com"),
      ],
      BASE,
      60000,
    );

    // The real navigation sounds; the cursor page-change beside it does not.
    expect(schedule.map((n) => n.atMs)).toEqual([2000]);
  });

  it("keeps an inferred hop that is far from any real navigation", () => {
    const schedule = buildNavigationSchedule(
      [
        event("navigation", BASE + 1000, "a", "x.com"),
        event("cursor", BASE + 1100, "a", "x.com"),
        event("cursor", BASE + 40000, "a", "y.com"),
      ],
      BASE,
      60000,
    );

    expect(schedule.map((n) => n.atMs)).toEqual([1000, 40000]);
  });
});

describe("navigationsCrossed", () => {
  const schedule = buildNavigationSchedule(
    [
      event("navigation", BASE + 1000, "a", "x.com"),
      event("navigation", BASE + 5000, "a", "y.com"),
      event("navigation", BASE + 9000, "a", "z.com"),
    ],
    BASE,
    10000,
  );

  it("returns only the moments inside the advanced span", () => {
    expect(
      navigationsCrossed(schedule, 0, 5000, 10000).map((n) => n.atMs),
    ).toEqual([1000, 5000]);
  });

  it("excludes the boundary already played and includes the new one", () => {
    expect(
      navigationsCrossed(schedule, 1000, 5000, 10000).map((n) => n.atMs),
    ).toEqual([5000]);
  });

  it("covers both sides of a loop wrap so replays retrigger", () => {
    expect(
      navigationsCrossed(schedule, 8000, 1500, 10000).map((n) => n.atMs),
    ).toEqual([9000, 1000]);
  });

  it("returns nothing when the clock has not advanced", () => {
    expect(navigationsCrossed(schedule, 5000, 5000, 10000)).toHaveLength(0);
  });
});
