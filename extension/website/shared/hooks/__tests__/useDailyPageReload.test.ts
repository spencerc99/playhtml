// ABOUTME: Tests local-day rollover for unattended installation pages.
// ABOUTME: Covers midnight timers, repeated boundaries, sleeping tabs, and cleanup.

// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  localDateKey,
  millisecondsUntilNextLocalDay,
  useDailyPageReload,
} from "../useDailyPageReload";

async function renderDailyReload(reloadPage: () => void, now: () => Date) {
  const container = document.createElement("div");
  const root = createRoot(container);

  function HookHarness() {
    useDailyPageReload(reloadPage, now);
    return null;
  }

  await act(async () => root.render(createElement(HookHarness)));
  return async () => act(async () => root.unmount());
}

function setVisibility(value: DocumentVisibilityState) {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    value,
  });
  document.dispatchEvent(new Event("visibilitychange"));
}

describe("daily page reload timing", () => {
  let now: Date;

  beforeEach(() => {
    vi.useFakeTimers();
    now = new Date(2026, 0, 15, 23, 59, 50);
    (
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    setVisibility("visible");
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("calculates the next boundary from the local calendar", () => {
    const now = new Date(2026, 2, 8, 22, 30, 0);
    const nextDay = new Date(
      now.getTime() + millisecondsUntilNextLocalDay(now),
    );

    expect(localDateKey(nextDay)).toBe(localDateKey(new Date(2026, 2, 9)));
    expect(nextDay.getHours()).toBe(0);
    expect(nextDay.getMinutes()).toBe(0);
  });

  it("reloads at midnight and recalculates the following boundary", async () => {
    const reloadPage = vi.fn();
    const unmount = await renderDailyReload(reloadPage, () => now);

    now = new Date(2026, 0, 16, 0, 0, 0);
    await act(async () => vi.advanceTimersByTime(10_000));
    expect(reloadPage).toHaveBeenCalledTimes(1);

    now = new Date(2026, 0, 17, 0, 0, 0);
    await act(async () => vi.advanceTimersByTime(24 * 60 * 60 * 1000));
    expect(reloadPage).toHaveBeenCalledTimes(2);

    await unmount();
  });

  it("reloads when a sleeping page becomes visible on another day", async () => {
    const reloadPage = vi.fn();
    const unmount = await renderDailyReload(reloadPage, () => now);

    setVisibility("hidden");
    now = new Date(2026, 0, 16, 8, 0, 0);
    setVisibility("visible");

    expect(reloadPage).toHaveBeenCalledTimes(1);
    setVisibility("visible");
    expect(reloadPage).toHaveBeenCalledTimes(1);

    await unmount();
  });

  it("cancels the scheduled reload when the page unmounts", async () => {
    const reloadPage = vi.fn();
    const unmount = await renderDailyReload(reloadPage, () => now);

    await unmount();
    await act(async () => vi.advanceTimersByTime(10_000));

    expect(reloadPage).not.toHaveBeenCalled();
  });
});
