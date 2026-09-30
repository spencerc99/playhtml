// ABOUTME: Verifies local heuristics that turn browsing events into walking records.
// ABOUTME: Covers period boundaries, trace cadence, page hues, departures, and settled places.

import { describe, expect, it } from "vitest";
import { parseColorToHsl } from "@movement/utils/eventUtils";
import type { CollectionEvent } from "../collectors/types";
import type { ScreenTimeSession } from "../storage/LocalEventStore";
import {
  attachWalkingRecordTraces,
  colorForDomain,
  deriveWalkingRecord,
  getWalkingRecordPeriodRange,
  getWalkingRecordTraceTargets,
  paletteColorForIndex,
  summarizeWalkingRecordPeriods,
  type WalkingRecordDomain,
} from "../history/walkingRecord";
import { risoInkColor } from "../utils/risoInk";

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
    activeDayCount: 0,
    eventCounts: { navigation: 2 },
    ...overrides,
  };
}

describe("walking record ranges", () => {
  it("uses the current Monday-to-Sunday week by default", () => {
    const range = getWalkingRecordPeriodRange(
      "week",
      0,
      new Date(2026, 6, 30, 14),
    );

    expect(new Date(range.startTs)).toEqual(new Date(2026, 6, 27));
    expect(new Date(range.endTs + 1)).toEqual(new Date(2026, 7, 3));
  });

  it("moves backward by whole calendar weeks", () => {
    const range = getWalkingRecordPeriodRange(
      "week",
      -1,
      new Date(2026, 6, 30, 14),
    );

    expect(new Date(range.startTs)).toEqual(new Date(2026, 6, 20));
    expect(new Date(range.endTs + 1)).toEqual(new Date(2026, 6, 27));
  });

  it("uses navigable calendar months", () => {
    const current = getWalkingRecordPeriodRange(
      "month",
      0,
      new Date(2026, 6, 30, 14),
    );
    const previous = getWalkingRecordPeriodRange(
      "month",
      -1,
      new Date(2026, 6, 30, 14),
    );

    expect(new Date(current.startTs)).toEqual(new Date(2026, 6, 1));
    expect(new Date(current.endTs + 1)).toEqual(new Date(2026, 7, 1));
    expect(new Date(previous.startTs)).toEqual(new Date(2026, 5, 1));
    expect(new Date(previous.endTs + 1)).toEqual(new Date(2026, 6, 1));
  });

  it("uses navigable calendar years", () => {
    const current = getWalkingRecordPeriodRange(
      "year",
      0,
      new Date(2026, 6, 30, 14),
    );
    const previous = getWalkingRecordPeriodRange(
      "year",
      -1,
      new Date(2026, 6, 30, 14),
    );

    expect(new Date(current.startTs)).toEqual(new Date(2026, 0, 1));
    expect(new Date(current.endTs + 1)).toEqual(new Date(2027, 0, 1));
    expect(new Date(previous.startTs)).toEqual(new Date(2025, 0, 1));
    expect(new Date(previous.endTs + 1)).toEqual(new Date(2026, 0, 1));
  });

  it("summarizes actual browsing time across the twelve visible periods", () => {
    const now = new Date(2026, 6, 30, 14);
    const previousWeek = getWalkingRecordPeriodRange("week", -1, now);
    const currentWeek = getWalkingRecordPeriodRange("week", 0, now);
    const sessions: ScreenTimeSession[] = [
      {
        url: "https://example.com/previous",
        focusTs: previousWeek.startTs + 1_000,
        blurTs: previousWeek.startTs + 3_601_000,
        durationMs: 60 * 60_000,
      },
      {
        url: "https://example.com/current",
        focusTs: currentWeek.startTs + 1_000,
        blurTs: currentWeek.startTs + 7_201_000,
        durationMs: 2 * 60 * 60_000,
      },
    ];

    const summaries = summarizeWalkingRecordPeriods("week", sessions, 12, now);

    expect(summaries).toHaveLength(12);
    expect(summaries.map((summary) => summary.offset)).toEqual([
      -11, -10, -9, -8, -7, -6, -5, -4, -3, -2, -1, 0,
    ]);
    expect(summaries.at(-2)?.totalTimeMs).toBe(60 * 60_000);
    expect(summaries.at(-1)?.totalTimeMs).toBe(2 * 60 * 60_000);
  });
});

describe("walking record color and trace cadence", () => {
  it("shifts page hues from the person's chosen color deterministically", () => {
    const first = colorForDomain("#4a9a8a", "foldedpaper.garden");
    const again = colorForDomain("#4a9a8a", "foldedpaper.garden");
    const elsewhere = colorForDomain("#4a9a8a", "diagram.website");

    expect(first).toBe(again);
    expect(first).not.toBe("#4a9a8a");
    expect(elsewhere).not.toBe(first);
  });

  it("generates distinct muted RISO colors for categorical accents", () => {
    const colors = Array.from({ length: 8 }, (_, index) =>
      paletteColorForIndex(index),
    );

    expect(new Set(colors).size).toBe(colors.length);
    expect(colors[0]).toBe(risoInkColor(0));
    for (const color of colors) {
      const hsl = parseColorToHsl(color);
      expect(hsl).not.toBeNull();
      expect(hsl!.s).toBeLessThanOrEqual(56);
      expect(hsl!.l).toBeLessThanOrEqual(58);
    }
  });

  it("summarizes months by week and years by month", () => {
    const monthRange = getWalkingRecordPeriodRange(
      "month",
      0,
      new Date(2026, 6, 30, 14),
    );
    const yearRange = getWalkingRecordPeriodRange(
      "year",
      0,
      new Date(2026, 6, 30, 14),
    );
    const month = deriveWalkingRecord({
      period: "month",
      baseColor: "#4a9a8a",
      events: [],
      sessions: [],
      domains: [],
      range: monthRange,
    });
    const year = deriveWalkingRecord({
      period: "year",
      baseColor: "#4a9a8a",
      events: [],
      sessions: [],
      domains: [],
      range: yearRange,
    });

    expect(month.dayPlates.map((plate) => plate.day)).toEqual([
      "week 1",
      "week 2",
      "week 3",
      "week 4",
      "week 5",
    ]);
    expect(year.dayPlates).toHaveLength(12);
    expect(year.dayPlates[0].day).toBe("jan");
    expect(year.dayPlates[11].day).toBe("dec");
  });

  it("distinguishes future intervals from past days without activity", () => {
    const now = new Date(2026, 6, 29, 12);
    const range = getWalkingRecordPeriodRange("week", 0, now);
    const record = deriveWalkingRecord({
      period: "week",
      baseColor: "#4a9a8a",
      events: [],
      sessions: [],
      domains: [],
      range,
      nowTs: now.getTime(),
    });

    expect(record.dayPlates.map((plate) => plate.vignette)).toEqual([
      "no trace kept",
      "no trace kept",
      "no trace kept",
      "still to come",
      "still to come",
      "still to come",
      "still to come",
    ]);
    expect(record.dayPlates.map((plate) => plate.future)).toEqual([
      false,
      false,
      false,
      true,
      true,
      true,
      true,
    ]);
  });
});

describe("deriveWalkingRecord", () => {
  it("finds rare departures from main roads and weights quiet-street time", () => {
    const range = getWalkingRecordPeriodRange(
      "week",
      -1,
      new Date(2026, 6, 30, 14),
    );
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
        {
          event: "focus",
          favicon_url: "https://github.githubassets.com/favicons/favicon.svg",
        },
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
      period: "week",
      baseColor: "#4a9a8a",
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
        note: "your first visit · stayed 11 minutes",
        fromFaviconUrl: "https://github.githubassets.com/favicons/favicon.svg",
      }),
    ]);
    expect(
      record.timeSpent.find((entry) => entry.site === "github.com")?.faviconUrl,
    ).toBe("https://github.githubassets.com/favicons/favicon.svg");
    expect(record.pageCount).toBe(2);
    expect(record.cursorDistancePx).toBeCloseTo(100);
    expect(record.dayPlates).toHaveLength(7);
    expect(record.dayPlates[0]).toEqual(
      expect.objectContaining({
        day: "mon",
        vignette: "11m on foldedpaper.garden",
        portraitDay: "2026-07-20",
        traceTargets: expect.arrayContaining([
          {
            id: "day:2026-07-20",
            url: quietSession.url,
            startTs: quietSession.focusTs,
            endTs: quietSession.blurTs,
          },
        ]),
      }),
    );

    const targets = getWalkingRecordTraceTargets(record);
    expect(targets).toHaveLength(2);

    const tracedRecord = attachWalkingRecordTraces(record, [
      {
        targetId: "day:2026-07-20",
        paths: [
          [
            { x: 0.1, y: 0.2 },
            { x: 0.4, y: 0.6 },
          ],
        ],
      },
    ]);
    expect(tracedRecord.dayPlates[0].tracePaths[0]).toEqual([
      { x: 0.1, y: 0.2 },
      { x: 0.4, y: 0.6 },
    ]);
    expect(tracedRecord.dayPlates[0].tracePaths).toHaveLength(2);
    expect(tracedRecord.departures[0]).not.toHaveProperty("tracePaths");
  });

  it("surfaces smaller places with active returns across the report week", () => {
    const range = getWalkingRecordPeriodRange(
      "week",
      -1,
      new Date(2026, 6, 30, 14),
    );
    const monday = range.startTs + 9 * 60 * 60_000;
    const gardenSessions = [0, 2, 4].map((dayOffset, index) => ({
      url: `https://garden.example/page-${index + 1}`,
      focusTs: monday + dayOffset * 24 * 60 * 60_000,
      blurTs: monday + dayOffset * 24 * 60 * 60_000 + 12 * 60_000,
      durationMs: 12 * 60_000,
    }));
    const leadingSessions = Array.from({ length: 5 }, (_, index) => ({
      url: `https://leader-${index + 1}.example/work`,
      focusTs: monday + index * 60_000,
      blurTs: monday + index * 60_000 + 60 * 60_000,
      durationMs: 60 * 60_000,
    }));

    const record = deriveWalkingRecord({
      period: "week",
      baseColor: "#4a9a8a",
      events: [],
      sessions: [...leadingSessions, ...gardenSessions],
      activity: gardenSessions.map((session) => ({
        url: session.url,
        windowStarts: Array.from(
          { length: 12 },
          (_, index) => session.focusTs + index * 30_000,
        ),
      })),
      domains: [
        ...leadingSessions.map((session, index) =>
          domain(`leader-${index + 1}.example`, {
            sessionCount: 20,
            totalTimeMs: session.durationMs,
          }),
        ),
        domain("garden.example", {
          sessionCount: 3,
          uniquePageCount: 3,
          activeDayCount: 3,
        }),
      ],
      range,
    });

    expect(record.settledPlaces).toEqual([
      expect.objectContaining({
        site: "garden.example",
        activeTime: "18m active",
        evidence: "returned in the mornings on 3 days · visited 3 pages",
        hue: paletteColorForIndex(0),
      }),
    ]);
  });

  it("keeps top-time and popular sites out of settled places", () => {
    const range = getWalkingRecordPeriodRange(
      "week",
      -1,
      new Date(2026, 6, 30, 14),
    );
    const monday = range.startTs + 9 * 60 * 60_000;
    const sessions = ["youtube.com", "top.example"].flatMap((site, siteIndex) =>
      [0, 2, 4].map((dayOffset) => ({
        url: `https://${site}/page`,
        focusTs: monday + dayOffset * 24 * 60 * 60_000 + siteIndex * 60_000,
        blurTs:
          monday +
          dayOffset * 24 * 60 * 60_000 +
          siteIndex * 60_000 +
          20 * 60_000,
        durationMs: 20 * 60_000,
      })),
    );
    const record = deriveWalkingRecord({
      period: "week",
      baseColor: "#4a9a8a",
      events: [],
      sessions,
      activity: sessions.map((session) => ({
        url: session.url,
        windowStarts: [session.focusTs, session.focusTs + 30_000],
      })),
      domains: [
        domain("youtube.com", { sessionCount: 3 }),
        domain("top.example", { sessionCount: 3 }),
      ],
      range,
    });

    expect(record.settledPlaces).toEqual([]);
  });

  it("does not mistake one passive session for a settled place", () => {
    const range = getWalkingRecordPeriodRange(
      "week",
      -1,
      new Date(2026, 6, 30, 14),
    );
    const focusTs = range.startTs + 9 * 60 * 60_000;
    const record = deriveWalkingRecord({
      period: "week",
      baseColor: "#4a9a8a",
      events: [],
      sessions: [
        {
          url: "https://passive.example/video",
          focusTs,
          blurTs: focusTs + 50 * 60_000,
          durationMs: 50 * 60_000,
        },
      ],
      activity: [],
      domains: [domain("passive.example", { sessionCount: 1 })],
      range,
    });

    expect(record.settledPlaces).toEqual([]);
  });

  it("omits a departure when no browsing evidence was recorded", () => {
    const range = getWalkingRecordPeriodRange(
      "week",
      -1,
      new Date(2026, 6, 30, 14),
    );
    const mondayMorning = new Date(2026, 6, 20, 9).getTime();
    const departureTs = mondayMorning + 5 * 60_000;
    const nextFocusTs = mondayMorning + 7 * 60_000;

    const record = deriveWalkingRecord({
      period: "week",
      baseColor: "#4a9a8a",
      events: [
        event(
          "main-focus",
          "navigation",
          mondayMorning,
          "https://google.com/search",
          { event: "focus" },
        ),
        event(
          "departure-focus",
          "navigation",
          departureTs,
          "https://tiny.garden/path",
          { event: "focus" },
        ),
        event(
          "main-refocus",
          "navigation",
          nextFocusTs,
          "https://google.com/search",
          { event: "focus" },
        ),
      ],
      sessions: [],
      domains: [
        domain("google.com", { sessionCount: 100 }),
        domain("tiny.garden", {
          firstVisit: departureTs,
          lastVisit: departureTs,
          sessionCount: 0,
        }),
      ],
      range,
    });

    expect(record.departures).toEqual([]);
    expect(record.movementCount).toBe(0);
  });

  it("describes a sub-minute active departure without rounding it to zero", () => {
    const range = getWalkingRecordPeriodRange(
      "week",
      -1,
      new Date(2026, 6, 30, 14),
    );
    const mondayMorning = new Date(2026, 6, 20, 9).getTime();
    const departureTs = mondayMorning + 5 * 60_000;

    const record = deriveWalkingRecord({
      period: "week",
      baseColor: "#4a9a8a",
      events: [
        event(
          "main-focus",
          "navigation",
          mondayMorning,
          "https://google.com/search",
          { event: "focus" },
        ),
        event(
          "departure-focus",
          "navigation",
          departureTs,
          "https://tiny.garden/path",
          { event: "focus" },
        ),
      ],
      activity: [
        {
          url: "https://tiny.garden/path",
          windowStarts: [departureTs],
        },
      ],
      sessions: [
        {
          url: "https://tiny.garden/path",
          focusTs: departureTs,
          blurTs: departureTs + 45_000,
          durationMs: 45_000,
        },
      ],
      domains: [
        domain("google.com", { sessionCount: 100 }),
        domain("tiny.garden", {
          firstVisit: departureTs - 2 * 60_000,
          lastVisit: departureTs,
          sessionCount: 1,
        }),
      ],
      range,
    });

    expect(record.departures).toEqual([
      expect.objectContaining({
        to: "tiny.garden",
        time: "< 1 min active",
        note: "actively browsed",
      }),
    ]);
  });

  it("uses the most actively browsed session for a portrait and preserves a derived mark", () => {
    const range = getWalkingRecordPeriodRange(
      "week",
      -1,
      new Date(2026, 6, 30, 14),
    );
    const monday = range.startTs + 9 * 60 * 60_000;
    const lightlyTracedSession: ScreenTimeSession = {
      url: "https://lightly-traced.example/long",
      focusTs: monday,
      blurTs: monday + 2 * 60 * 60_000,
      durationMs: 2 * 60 * 60_000,
    };
    const tracedSession: ScreenTimeSession = {
      url: "https://traced.example/short",
      focusTs: monday + 3 * 60 * 60_000,
      blurTs: monday + 3 * 60 * 60_000 + 12 * 60_000,
      durationMs: 12 * 60_000,
    };
    const record = deriveWalkingRecord({
      period: "week",
      baseColor: "#4a9a8a",
      events: [
        event(
          "light-trace-1",
          "cursor",
          lightlyTracedSession.focusTs + 1_000,
          lightlyTracedSession.url,
          { event: "move", x: 0.2, y: 0.3 },
        ),
        event(
          "light-trace-2",
          "cursor",
          lightlyTracedSession.focusTs + 2_000,
          lightlyTracedSession.url,
          { event: "move", x: 0.5, y: 0.6 },
        ),
        event(
          "trace-1",
          "cursor",
          tracedSession.focusTs + 1_000,
          tracedSession.url,
          { event: "move", x: 0.2, y: 0.3 },
        ),
        event(
          "trace-2",
          "cursor",
          tracedSession.focusTs + 2_000,
          tracedSession.url,
          { event: "move", x: 0.5, y: 0.6 },
        ),
        event(
          "trace-3",
          "cursor",
          tracedSession.focusTs + 3_000,
          tracedSession.url,
          { event: "move", x: 0.7, y: 0.4 },
        ),
      ],
      sessions: [lightlyTracedSession, tracedSession],
      domains: [
        domain("lightly-traced.example", { sessionCount: 20 }),
        domain("traced.example", { sessionCount: 20 }),
      ],
      range,
      nowTs: range.endTs + 1,
    });

    expect(record.dayPlates[0]).toEqual(
      expect.objectContaining({
        traceTargets: expect.arrayContaining([
          expect.objectContaining({ url: tracedSession.url }),
          expect.objectContaining({ url: lightlyTracedSession.url }),
        ]),
        tracePaths: expect.arrayContaining([
          expect.arrayContaining([expect.any(Object)]),
        ]),
      }),
    );

    const withoutStoredCursorPath = attachWalkingRecordTraces(record, []);
    expect(
      withoutStoredCursorPath.dayPlates[0].tracePaths[0].length,
    ).toBeGreaterThan(1);
  });

  it("shows five real sites before the remaining-time summary", () => {
    const range = getWalkingRecordPeriodRange(
      "week",
      -1,
      new Date(2026, 6, 30, 14),
    );
    const domains = Array.from({ length: 8 }, (_, index) =>
      domain(`site-${index + 1}.example`, {
        sessionCount: index < 6 ? 20 : 2,
      }),
    );
    const sessions = domains.map((entry, index) => {
      const durationMs = (8 - index) * 10 * 60_000;
      return {
        url: `https://${entry.domain}/page`,
        focusTs: range.startTs + index * 60 * 60_000,
        blurTs: range.startTs + index * 60 * 60_000 + durationMs,
        durationMs,
      };
    });

    const record = deriveWalkingRecord({
      period: "week",
      baseColor: "#4a9a8a",
      events: [],
      sessions,
      domains,
      range,
      nowTs: range.endTs + 1,
    });

    expect(record.timeSpent.map((entry) => entry.site)).toEqual([
      "site-1.example",
      "site-2.example",
      "site-3.example",
      "site-4.example",
      "site-5.example",
      "3 others",
    ]);
    expect(record.timeSpent[0].time).toBe("1h20m");
    expect(record.timeSpent.at(-1)?.time).toBe("1h");
  });

  it("ranks active browsing above a longer passive visit", () => {
    const range = getWalkingRecordPeriodRange(
      "week",
      -1,
      new Date(2026, 6, 30, 14),
    );
    const mondayMorning = new Date(2026, 6, 20, 9).getTime();
    const firstDepartureTs = mondayMorning + 5 * 60_000;
    const secondDepartureTs = mondayMorning + 15 * 60_000;

    const record = deriveWalkingRecord({
      period: "week",
      baseColor: "#4a9a8a",
      events: [
        event("main-1", "navigation", mondayMorning, "https://google.com", {
          event: "focus",
        }),
        event(
          "quiet-1",
          "navigation",
          firstDepartureTs,
          "https://still.example/path",
          { event: "focus" },
        ),
        event(
          "main-2",
          "navigation",
          mondayMorning + 10 * 60_000,
          "https://google.com",
          { event: "focus" },
        ),
        event(
          "quiet-2",
          "navigation",
          secondDepartureTs,
          "https://moving.example/path",
          { event: "focus" },
        ),
        event(
          "moving-cursor",
          "cursor",
          secondDepartureTs + 1_000,
          "https://moving.example/path",
          { event: "move", x: 0.2, y: 0.4 },
        ),
        event(
          "main-3",
          "navigation",
          mondayMorning + 20 * 60_000,
          "https://google.com",
          { event: "focus" },
        ),
      ],
      activity: [
        {
          url: "https://moving.example/path",
          windowStarts: Array.from(
            { length: 30 },
            (_, index) => secondDepartureTs + index * 30_000,
          ),
        },
      ],
      sessions: [
        {
          url: "https://still.example/path",
          focusTs: firstDepartureTs,
          blurTs: firstDepartureTs + 50 * 60_000,
          durationMs: 50 * 60_000,
        },
        {
          url: "https://moving.example/path",
          focusTs: secondDepartureTs,
          blurTs: secondDepartureTs + 15 * 60_000,
          durationMs: 15 * 60_000,
        },
      ],
      domains: [
        domain("google.com", { sessionCount: 100 }),
        domain("still.example", {
          firstVisit: firstDepartureTs,
          sessionCount: 0,
        }),
        domain("moving.example", {
          firstVisit: secondDepartureTs,
          sessionCount: 0,
        }),
      ],
      range,
    });

    expect(record.departures.map((departure) => departure.to)).toEqual([
      "moving.example",
      "still.example",
    ]);
  });
});
