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
            latestFaviconUrl: "https://example.com/favicon.png",
          },
        ],
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

    const record = await loadWalkingRecord("week", range, "#4a9a8a", progress);

    expect(progress).toHaveBeenCalledTimes(5);
    expect(
      progress.mock.calls.slice(0, 2).map(([update]) => update.message),
    ).toEqual(["gathering browsing activity…", "mapping familiar roads…"]);
    expect(progress).toHaveBeenNthCalledWith(3, {
      completed: 3,
      total: 4,
      message: "arranging this week’s record…",
    });
    expect(progress).toHaveBeenNthCalledWith(4, {
      completed: 3,
      total: 4,
      message: "restoring cursor trails…",
    });
    expect(progress).toHaveBeenLastCalledWith({
      completed: 4,
      total: 4,
      message: "finishing this week’s record…",
    });
    expect(record.timeSpent[0].faviconUrl).toBe(
      "https://example.com/favicon.png",
    );
    expect(browser.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "GET_WALKING_RECORD_MOVEMENT",
      }),
    );
    expect(browser.runtime.sendMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ faviconDomains: expect.anything() }),
    );
    expect(browser.runtime.sendMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "GET_SCREEN_TIME" }),
    );

    await loadWalkingRecord("week", range, "#4a9a8a", vi.fn());
    expect(
      vi
        .mocked(browser.runtime.sendMessage)
        .mock.calls.filter(([message]) => message.type === "GET_ALL_DOMAINS"),
    ).toHaveLength(1);
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

  it("delivers the base record before cursor movement finishes", async () => {
    const range = getWalkingRecordPeriodRange(
      "week",
      0,
      new Date(2026, 6, 30, 14),
    );
    let finishMovement: ((response: unknown) => void) | undefined;
    const movementResponse = new Promise((resolve) => {
      finishMovement = resolve;
    });
    vi.mocked(browser.runtime.sendMessage).mockImplementation(
      async (message: { type: string }) => {
        if (message.type === "GET_ALL_DOMAINS") {
          return { success: true, domains: [] };
        }
        if (message.type === "GET_WALKING_RECORD_EVENTS") {
          const focusTs = range.startTs + 60_000;
          return {
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
            sessions: [
              {
                url: "https://example.com/page",
                focusTs,
                blurTs: focusTs + 60_000,
                durationMs: 60_000,
              },
            ],
          };
        }
        return movementResponse;
      },
    );
    const onBaseRecord = vi.fn();

    const loading = loadWalkingRecord(
      "week",
      range,
      "#4a9a8a",
      vi.fn(),
      onBaseRecord,
    );

    await vi.waitFor(() => expect(onBaseRecord).toHaveBeenCalledOnce());
    expect(onBaseRecord.mock.calls[0][0].landscapePaths).toEqual([]);

    finishMovement?.({ success: true, traces: [], landscapePaths: [] });
    await loading;
  });
});
