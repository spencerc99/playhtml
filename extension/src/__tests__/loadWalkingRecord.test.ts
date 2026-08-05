// ABOUTME: Verifies walking-record loading progress follows completed local-data work.
// ABOUTME: Covers parallel data steps, record arrangement, and cursor trace completion.

import { beforeEach, describe, expect, it, vi } from "vitest";
import browser from "webextension-polyfill";
import { loadWalkingRecord } from "../history/loadWalkingRecord";
import { getWalkingRecordPeriodRange } from "../history/walkingRecord";

describe("loadWalkingRecord", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reports completed data work and finishes after restoring traces", async () => {
    const range = getWalkingRecordPeriodRange(
      "week",
      -1,
      new Date(2026, 6, 30, 14),
    );
    const focusTs = range.startTs + 60_000;
    const responses = {
      GET_WALKING_RECORD_EVENTS: {
        success: true,
        events: [
          {
            id: "focus",
            type: "navigation",
            ts: focusTs,
            data: { event: "focus" },
            meta: {
              pid: "pk_test",
              sid: "sid_test",
              url: "https://example.com/page",
              vw: 1_000,
              vh: 800,
              tz: "America/Los_Angeles",
            },
          },
        ],
        cursorDistancePx: 0,
      },
      GET_SCREEN_TIME: {
        success: true,
        sessions: [
          {
            url: "https://example.com/page",
            focusTs,
            blurTs: focusTs + 60_000,
            durationMs: 60_000,
          },
        ],
      },
      GET_ALL_DOMAINS: {
        success: true,
        domains: [
          {
            domain: "example.com",
            eventCount: 1,
            firstVisit: focusTs,
            lastVisit: focusTs,
            totalTimeMs: 60_000,
            uniquePageCount: 1,
            sessionCount: 1,
            eventCounts: { navigation: 1 },
          },
        ],
      },
      GET_WALKING_RECORD_TRACES: {
        success: true,
        traces: [],
      },
    };
    vi.mocked(browser.runtime.sendMessage).mockImplementation(
      async (message: { type: keyof typeof responses }) =>
        responses[message.type],
    );
    const progress = vi.fn();

    await loadWalkingRecord("week", range, "#4a9a8a", progress);

    expect(progress).toHaveBeenCalledTimes(5);
    expect(
      progress.mock.calls.slice(0, 3).map(([update]) => update.completed),
    ).toEqual([1, 2, 3]);
    expect(progress).toHaveBeenNthCalledWith(4, {
      completed: 4,
      total: 5,
      message: "arranging this week’s record…",
    });
    expect(progress).toHaveBeenLastCalledWith({
      completed: 5,
      total: 5,
      message: "cursor trails restored…",
    });
  });
});
