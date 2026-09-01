// ABOUTME: Tests compact time-span formatting for the developer playback console.
// ABOUTME: Keeps long archive ranges from crowding the top instrumentation bar.
// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import type { CollectionEvent } from "../../types";
import { formatCompactTimeSpan } from "../../utils/timeFormat";
import { StatsConsole } from "../StatsConsole";

describe("formatCompactTimeSpan", () => {
  it("keeps minute, hour, and day spans compact", () => {
    const start = 1_700_000_000_000;

    expect(formatCompactTimeSpan(start, start + 30_000)).toBe("<1m");
    expect(formatCompactTimeSpan(start, start + 12 * 60_000)).toBe("12m");
    expect(formatCompactTimeSpan(start, start + 90 * 60_000)).toBe("1.5h");
    expect(formatCompactTimeSpan(start, start + 36 * 60 * 60_000)).toBe("1.5d");
  });

  it("omits empty and reversed ranges", () => {
    expect(formatCompactTimeSpan(0, 0)).toBe("—");
    expect(formatCompactTimeSpan(200, 100)).toBe("—");
  });
});

describe("StatsConsole playback time", () => {
  it("opens at the current playback position", async () => {
    const testGlobal = globalThis as typeof globalThis & {
      IS_REACT_ACT_ENVIRONMENT?: boolean;
    };
    testGlobal.IS_REACT_ACT_ENVIRONMENT = true;
    vi.stubGlobal(
      "requestAnimationFrame",
      vi.fn(() => 1),
    );
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    const start = 1_700_000_000_000;
    const end = start + 10 * 60_000;
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        React.createElement(StatsConsole, {
          events: [
            { type: "cursor", ts: start },
            { type: "cursor", ts: end },
          ] as CollectionEvent[],
          trailCount: 1,
          cycleDurationMs: 10_000,
          animationSpeed: 1,
          playbackSource: "archive",
          getPlaybackElapsedMs: () => 5_000,
          leftOffset: 0,
          loading: false,
          error: null,
        }),
      );
    });

    const expected = new Date(start + 5 * 60_000).toLocaleTimeString(
      undefined,
      { hour: "numeric", minute: "2-digit", second: "2-digit" },
    );
    expect(
      container.querySelector('[data-testid="playback-current-time"]')
        ?.textContent,
    ).toBe(expected);

    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
    delete testGlobal.IS_REACT_ACT_ENVIRONMENT;
  });

  it("holds at the end of finite playback instead of wrapping backward", async () => {
    const testGlobal = globalThis as typeof globalThis & {
      IS_REACT_ACT_ENVIRONMENT?: boolean;
    };
    testGlobal.IS_REACT_ACT_ENVIRONMENT = true;
    vi.stubGlobal(
      "requestAnimationFrame",
      vi.fn(() => 1),
    );
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    const start = 1_700_000_000_000;
    const end = start + 10 * 60_000;
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        React.createElement(StatsConsole, {
          events: [
            { type: "keyboard", ts: start },
            { type: "keyboard", ts: end },
          ] as CollectionEvent[],
          trailCount: 0,
          cycleDurationMs: 10_000,
          animationSpeed: 1,
          playbackSource: "live",
          getPlaybackElapsedMs: () => 10_000,
          leftOffset: 0,
          loading: false,
          error: null,
        }),
      );
    });

    const expected = new Date(end).toLocaleTimeString(undefined, {
      hour: "numeric",
      minute: "2-digit",
      second: "2-digit",
    });
    expect(
      container.querySelector('[data-testid="playback-current-time"]')
        ?.textContent,
    ).toBe(expected);

    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
    delete testGlobal.IS_REACT_ACT_ENVIRONMENT;
  });
});
