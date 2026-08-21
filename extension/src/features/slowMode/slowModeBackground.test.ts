// ABOUTME: Verifies the browser listener that redirects qualifying tabs into Slow Mode.
// ABOUTME: Uses real policy and state logic with in-memory browser boundaries.

import { describe, expect, it, vi } from "vitest";
import {
  SLOW_MODE_SETTINGS_KEY,
  SLOW_MODE_STATE_KEY,
  type SlowModeState,
} from "./slowMode";
import { createSlowModeNavigationHandler } from "./slowModeBackground";

function emptyState(): SlowModeState {
  return {
    farJumpCountByDay: {},
    lastCommuteAt: null,
    lastCommuteByDomain: {},
    rides: [],
  };
}

describe("Slow Mode browser interception", () => {
  it("redirects a qualifying top-frame navigation and records the ride", async () => {
    const stored: Record<string, unknown> = {
      [SLOW_MODE_SETTINGS_KEY]: { enabled: true, chancePercent: 100 },
      [SLOW_MODE_STATE_KEY]: emptyState(),
    };
    const set = vi.fn(async (items: Record<string, unknown>) => {
      Object.assign(stored, items);
    });
    const updateTab = vi.fn().mockResolvedValue(undefined);
    const handler = createSlowModeNavigationHandler({
      getStorage: async () => stored,
      setStorage: set,
      getCommutePageUrl: () => "chrome-extension://test/commute.html",
      updateTab,
      now: () => new Date("2026-08-21T17:00:00-07:00").getTime(),
      random: () => 0,
    });

    handler.rememberTabUrl(7, "https://garden.example/notes");
    await handler.onCommitted({
      tabId: 7,
      frameId: 0,
      url: "https://museum.example/exhibit",
      transitionType: "typed",
      transitionQualifiers: [],
    });

    expect(updateTab).toHaveBeenCalledOnce();
    const commuteUrl = new URL(updateTab.mock.calls[0][1]);
    expect(commuteUrl.pathname).toBe("/commute.html");
    expect(commuteUrl.searchParams.get("destination")).toBe(
      "https://museum.example/exhibit",
    );
    expect(commuteUrl.searchParams.get("ride")).toBe(
      `${new Date("2026-08-21T17:00:00-07:00").getTime()}:museum.example`,
    );
    const state = stored[SLOW_MODE_STATE_KEY] as SlowModeState;
    expect(state.rides).toHaveLength(1);
    expect(state.rides[0]).toMatchObject({
      destinationDomain: "museum.example",
      stopCount: 2,
      outcome: "riding",
    });
    expect(state.farJumpCountByDay["2026-08-21"]).toBe(1);
  });

  it("does not redirect subframes or link navigations", async () => {
    const updateTab = vi.fn().mockResolvedValue(undefined);
    const handler = createSlowModeNavigationHandler({
      getStorage: async () => ({
        [SLOW_MODE_SETTINGS_KEY]: { enabled: true, chancePercent: 100 },
        [SLOW_MODE_STATE_KEY]: emptyState(),
      }),
      setStorage: vi.fn().mockResolvedValue(undefined),
      getCommutePageUrl: () => "chrome-extension://test/commute.html",
      updateTab,
      now: () => Date.now(),
      random: () => 0,
    });

    handler.rememberTabUrl(7, "https://garden.example/notes");
    await handler.onCommitted({
      tabId: 7,
      frameId: 2,
      url: "https://museum.example/frame",
      transitionType: "typed",
      transitionQualifiers: [],
    });
    await handler.onCommitted({
      tabId: 7,
      frameId: 0,
      url: "https://museum.example/exhibit",
      transitionType: "link",
      transitionQualifiers: [],
    });

    expect(updateTab).not.toHaveBeenCalled();
  });
});
