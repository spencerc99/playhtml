// ABOUTME: Verifies local heuristics that turn browsing events into walking records.
// ABOUTME: Covers period boundaries, trace cadence, page hues, departures, and revisits.

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

    const summaries = summarizeWalkingRecordPeriods(
      "week",
      sessions,
      12,
      now,
    );

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
        note: "stayed 11 minutes · your first visit",
        familiarity: "new to you",
        hue: colorForDomain("#4a9a8a", "foldedpaper.garden"),
        accentHue: paletteColorForIndex(0),
        traceTarget: {
          id: `departure:${departureTs}:foldedpaper.garden`,
          url: quietSession.url,
          startTs: quietSession.focusTs,
          endTs: quietSession.blurTs,
        },
      }),
    ]);
    expect(record.timeSpent.map((entry) => entry.site)).toContain(
      "the quiet streets, together",
    );
    expect(
      record.timeSpent.find((entry) => entry.site === "github.com")?.faviconUrl,
    ).toBe("https://github.githubassets.com/favicons/favicon.svg");
    expect(record.pageCount).toBe(2);
    expect(record.cursorDistancePx).toBeCloseTo(100);
    expect(record.dayPlates).toHaveLength(7);
    expect(record.dayPlates[0]).toEqual(
      expect.objectContaining({
        day: "mon",
        vignette: "11 quiet minutes on foldedpaper.garden",
        traceTarget: {
          id: "day:2026-07-20",
          url: quietSession.url,
          startTs: quietSession.focusTs,
          endTs: quietSession.blurTs,
        },
      }),
    );

    const targets = getWalkingRecordTraceTargets(record);
    expect(targets).toHaveLength(2);

    const tracedRecord = attachWalkingRecordTraces(record, [
      {
        targetId: "day:2026-07-20",
        paths: [[{ x: 0.1, y: 0.2 }, { x: 0.4, y: 0.6 }]],
      },
      {
        targetId: `departure:${departureTs}:foldedpaper.garden`,
        paths: [[{ x: 0.3, y: 0.4 }, { x: 0.7, y: 0.8 }]],
      },
    ]);
    expect(tracedRecord.dayPlates[0].tracePaths).toEqual([
      [{ x: 0.1, y: 0.2 }, { x: 0.4, y: 0.6 }],
    ]);
    expect(tracedRecord.departures[0].tracePaths).toEqual([
      [{ x: 0.3, y: 0.4 }, { x: 0.7, y: 0.8 }],
    ]);
  });

  it("surfaces familiar small sites that went quiet before the report week", () => {
    const range = getWalkingRecordPeriodRange(
      "week",
      -1,
      new Date(2026, 6, 30, 14),
    );
    const oldVisit = range.startTs - 214 * 24 * 60 * 60 * 1_000;

    const record = deriveWalkingRecord({
      period: "week",
      baseColor: "#4a9a8a",
      events: [],
      sessions: [],
      domains: [
        domain("diagram.website", {
          firstVisit: oldVisit - 120 * 24 * 60 * 60 * 1_000,
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
        memory: "part of your browsing for 4 months before the gap",
        hue: paletteColorForIndex(0),
      }),
    ]);
    expect(record.totalTimeMs).toBe(0);
    expect(record.totalTimeLabel).toBe("0 min");
    expect(record.timeSpent).toEqual([]);
  });

  it("prefers sustained familiarity over a compressed visit burst", () => {
    const range = getWalkingRecordPeriodRange(
      "week",
      -1,
      new Date(2026, 6, 30, 14),
    );
    const lastVisit = range.startTs - 45 * 24 * 60 * 60_000;

    const record = deriveWalkingRecord({
      period: "week",
      baseColor: "#4a9a8a",
      events: [],
      sessions: [],
      domains: [
        domain("regular.example", {
          firstVisit: lastVisit - 180 * 24 * 60 * 60_000,
          lastVisit,
          sessionCount: 24,
        }),
        domain("application.example", {
          firstVisit: lastVisit - 2 * 24 * 60 * 60_000,
          lastVisit,
          sessionCount: 96,
        }),
      ],
      range,
    });

    expect(record.revisits.map((revisit) => revisit.site)).toEqual([
      "regular.example",
    ]);
  });

  it("keeps a real departure trace interval when no screen-time session completed", () => {
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

    expect(record.departures).toEqual([
      expect.objectContaining({
        to: "tiny.garden",
        familiarity: "new to you",
        tracePaths: [expect.arrayContaining([expect.any(Object)])],
        traceTarget: {
          id: `departure:${departureTs}:tiny.garden`,
          url: "https://tiny.garden/path",
          startTs: departureTs,
          endTs: nextFocusTs - 1,
        },
      }),
    ]);
  });

  it("uses a traceable session for a portrait and preserves a derived mark when cursor data is absent", () => {
    const range = getWalkingRecordPeriodRange(
      "week",
      -1,
      new Date(2026, 6, 30, 14),
    );
    const monday = range.startTs + 9 * 60 * 60_000;
    const untracedSession: ScreenTimeSession = {
      url: "https://untraced.example/long",
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
      ],
      sessions: [untracedSession, tracedSession],
      domains: [
        domain("untraced.example", { sessionCount: 20 }),
        domain("traced.example", { sessionCount: 20 }),
      ],
      range,
      nowTs: range.endTs + 1,
    });

    expect(record.dayPlates[0]).toEqual(
      expect.objectContaining({
        traceTarget: expect.objectContaining({ url: tracedSession.url }),
        tracePaths: [expect.arrayContaining([expect.any(Object)])],
      }),
    );

    const withoutStoredCursorPath = attachWalkingRecordTraces(record, []);
    expect(withoutStoredCursorPath.dayPlates[0].tracePaths[0].length).toBeGreaterThan(
      1,
    );
  });

  it("shows six real sites before the quiet-streets summary", () => {
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
      "site-6.example",
      "the quiet streets, together",
    ]);
    expect(record.timeSpent.at(-1)?.time).toBe("30 min");
  });

  it("ranks traceable departures above equally rare visits without movement", () => {
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
      sessions: [],
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
