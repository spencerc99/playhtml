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
        activity: [],
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
            activeDayCount: 1,
            eventCounts: { navigation: 1 },
          },
        ],
      },
      GET_WALKING_RECORD_DOMAIN_DAYS: {
        success: true,
        days: [],
      },
      GET_WALKING_RECORD_MOVEMENT: {
        success: true,
        traces: [],
        landscapePaths: [],
      },
    };
    vi.mocked(browser.runtime.sendMessage).mockImplementation(
      async (message: { type: keyof typeof responses }) =>
        responses[message.type],
    );
    const progress = vi.fn();

    await loadWalkingRecord("week", range, "#4a9a8a", progress);

    expect(progress).toHaveBeenCalledTimes(6);
    expect(
      progress.mock.calls.slice(0, 3).map(([update]) => update.message),
    ).toEqual([
      "gathering movement traces…",
      "counting browsing time…",
      "finding familiar places…",
    ]);
    expect(progress).toHaveBeenNthCalledWith(4, {
      completed: 4,
      total: 6,
      message: "tracing familiar routines…",
    });
    expect(progress).toHaveBeenNthCalledWith(5, {
      completed: 5,
      total: 6,
      message: "arranging this week’s record…",
    });
    expect(progress).toHaveBeenLastCalledWith({
      completed: 6,
      total: 6,
      message: "restoring cursor trails…",
    });
  });

  it("surfaces background reload guidance", async () => {
    const range = getWalkingRecordPeriodRange(
      "week",
      0,
      new Date(2026, 6, 30, 14),
    );
    vi.mocked(browser.runtime.sendMessage).mockResolvedValue({
      success: false,
      error:
        "Local history is waiting for an older extension process to close. Reload the extension and open a new tab.",
    });

    await expect(
      loadWalkingRecord("week", range, "#4a9a8a", vi.fn()),
    ).rejects.toThrow("Reload the extension and open a new tab.");
  });
});
