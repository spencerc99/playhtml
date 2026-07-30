// ABOUTME: Verifies the local heuristics that turn browsing events into a weekly walking record.
// ABOUTME: Covers completed-week boundaries, small-web departures, revisits, and quiet-street time.

import { describe, expect, it } from "vitest";
import type { CollectionEvent } from "../collectors/types";
import type { ScreenTimeSession } from "../storage/LocalEventStore";
import {
  deriveWalkingRecord,
  getLastCompletedWeek,
  type WalkingRecordDomain,
} from "../history/walkingRecord";

function event(
  id: string,
  type: CollectionEvent["type"],
  ts: number,
  url: string,
  data: unknown,
): CollectionEvent {
  return {
    id,
    type,
    ts,
    data,
    meta: {
      pid: "pk_test",
      sid: "sid_test",
      url,
      vw: 1_000,
      vh: 800,
      tz: "America/Los_Angeles",
    },
  };
}

function domain(
  name: string,
  overrides: Partial<WalkingRecordDomain> = {},
): WalkingRecordDomain {
  return {
    domain: name,
    eventCount: 20,
    firstVisit: 1,
    lastVisit: 1,
    totalTimeMs: 0,
    uniquePageCount: 1,
    sessionCount: 1,
    eventCounts: { navigation: 2 },
    ...overrides,
  };
}

describe("walking record ranges", () => {
  it("uses the last completed Monday-to-Sunday week", () => {
    const range = getLastCompletedWeek(new Date(2026, 6, 30, 14));

    expect(new Date(range.startTs)).toEqual(new Date(2026, 6, 20));
    expect(new Date(range.endTs + 1)).toEqual(new Date(2026, 6, 27));
  });
});

describe("deriveWalkingRecord", () => {
  it("finds rare departures from main roads and weights quiet-street time", () => {
    const range = getLastCompletedWeek(new Date(2026, 6, 30, 14));
    const mondayMorning = new Date(2026, 6, 20, 9).getTime();
    const departureTs = mondayMorning + 5 * 60_000;
    const quietSession: ScreenTimeSession = {
      url: "https://foldedpaper.garden/entry",
      focusTs: departureTs,
      blurTs: departureTs + 11 * 60_000,
      durationMs: 11 * 60_000,
    };
    const mainRoadSession: ScreenTimeSession = {
      url: "https://github.com/spencerc99/playhtml",
      focusTs: mondayMorning,
      blurTs: mondayMorning + 4 * 60_000,
      durationMs: 4 * 60_000,
    };
    const events = [
      event(
        "github-focus",
        "navigation",
        mondayMorning,
        "https://github.com/spencerc99/playhtml",
        { event: "focus" },
      ),
      event(
        "garden-focus",
        "navigation",
        departureTs,
        "https://foldedpaper.garden/entry",
        { event: "focus" },
      ),
      event(
        "garden-cursor-1",
        "cursor",
        departureTs + 1_000,
        "https://foldedpaper.garden/entry",
        { event: "move", x: 0.1, y: 0.2 },
      ),
      event(
        "garden-cursor-2",
        "cursor",
        departureTs + 2_000,
        "https://foldedpaper.garden/entry",
        { event: "move", x: 0.2, y: 0.2 },
      ),
    ];
    const domains = [
      domain("github.com", { sessionCount: 120, lastVisit: mondayMorning }),
      domain("foldedpaper.garden", {
        firstVisit: departureTs,
        lastVisit: departureTs,
      }),
    ];

    const record = deriveWalkingRecord({
      events,
      sessions: [mainRoadSession, quietSession],
      domains,
      range,
    });

    expect(record.movementCount).toBe(1);
    expect(record.departures).toEqual([
      expect.objectContaining({
        from: "github.com",
        to: "foldedpaper.garden",
        note: "stayed 11 minutes · your first visit",
        familiarity: "new to you",
      }),
    ]);
    expect(record.timeSpent.map((entry) => entry.site)).toContain(
      "the quiet streets, together",
    );
    expect(record.pageCount).toBe(2);
    expect(record.cursorDistancePx).toBeCloseTo(100);
    expect(record.dayPlates).toHaveLength(7);
    expect(record.dayPlates[0]).toEqual(
      expect.objectContaining({
        day: "mon",
        vignette: "11 quiet minutes on foldedpaper.garden",
      }),
    );
  });

  it("surfaces familiar small sites that went quiet before the report week", () => {
    const range = getLastCompletedWeek(new Date(2026, 6, 30, 14));
    const oldVisit = range.startTs - 214 * 24 * 60 * 60 * 1_000;

    const record = deriveWalkingRecord({
      events: [],
      sessions: [],
      domains: [
        domain("diagram.website", {
          sessionCount: 31,
          lastVisit: oldVisit,
          totalTimeMs: 90 * 60_000,
        }),
        domain("youtube.com", {
          sessionCount: 80,
          lastVisit: oldVisit,
        }),
      ],
      range,
    });

    expect(record.revisits).toEqual([
      expect.objectContaining({
        span: "7 months",
        site: "diagram.website",
        memory: "you visited 31 times before the gap",
      }),
    ]);
    expect(record.totalTimeMs).toBe(0);
    expect(record.totalTimeLabel).toBe("0 min");
    expect(record.timeSpent).toEqual([]);
  });
});
