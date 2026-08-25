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
    lastCommuteAt: null,
    lastCommuteByDomain: {},
    rides: [],
  };
}

describe("Slow Mode browser interception", () => {
  it("redirects a qualifying top-frame navigation and records the ride", async () => {
    const stored: Record<string, unknown> = {
      [SLOW_MODE_SETTINGS_KEY]: {
        enabled: true,
        chancePercent: 100,
        stopVisibility: "domain",
      },
      [SLOW_MODE_STATE_KEY]: emptyState(),
    };
    const set = vi.fn(async (items: Record<string, unknown>) => {
      Object.assign(stored, items);
    });
    const updateTab = vi.fn().mockResolvedValue(undefined);
    const handler = createSlowModeNavigationHandler({
      getStorage: async () => stored,
      setStorage: set,
      getCommutePageUrl: () => "https://wewere.online/commute/",
      updateTab,
      now: () => new Date("2026-08-21T17:00:00-07:00").getTime(),
      random: () => 0,
      createRideId: () => "ride_1234567890",
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
    expect(commuteUrl.origin).toBe("https://wewere.online");
    expect(commuteUrl.pathname).toBe("/commute/");
    expect(commuteUrl.search).toBe("");
    expect(new URLSearchParams(commuteUrl.hash.slice(1)).get("ride")).toBe(
      "ride_1234567890",
    );
    expect(commuteUrl.href).not.toContain("museum.example");
    const state = stored[SLOW_MODE_STATE_KEY] as SlowModeState;
    expect(state.rides).toHaveLength(1);
    expect(state.rides[0]).toMatchObject({
      destinationDomain: "museum.example",
      stopCount: 2,
      outcome: "riding",
    });
  });

  it("does not redirect subframes or link navigations", async () => {
    const updateTab = vi.fn().mockResolvedValue(undefined);
    const handler = createSlowModeNavigationHandler({
      getStorage: async () => ({
        [SLOW_MODE_SETTINGS_KEY]: {
          enabled: true,
          chancePercent: 100,
          stopVisibility: "domain",
        },
        [SLOW_MODE_STATE_KEY]: emptyState(),
      }),
      setStorage: vi.fn().mockResolvedValue(undefined),
      getCommutePageUrl: () => "https://wewere.online/commute/",
      updateTab,
      now: () => Date.now(),
      random: () => 0,
      createRideId: () => "ride_1234567890",
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
