// ABOUTME: Tests for milestone state management, threshold checks, and cooldown logic.
// ABOUTME: Uses vitest with jsdom and the webextension-polyfill mock from vitest.setup.ts.

import { describe, it, expect } from "vitest";
import {
  buildEmptyState,
  resetDailyIfNeeded,
  isOnCooldown,
  recordToastShown,
} from "../milestones/state";
import type { MilestoneState } from "../milestones/state";

describe("buildEmptyState", () => {
  it("returns a valid empty state", () => {
    const state = buildEmptyState();
    expect(state.lastShownDate).toBe("");
    expect(state.dailyShown.cursorDistance).toEqual([]);
    expect(state.dailyShown.screenTime).toEqual([]);
    expect(state.allTimeShown.sitesExplored).toEqual([]);
    expect(state.allTimeShown.domainVisits).toEqual({});
    expect(state.lastToastTs).toBe(0);
    expect(state.lastCopyIndex).toEqual({});
  });
});

describe("resetDailyIfNeeded", () => {
  it("resets daily state when date has changed", () => {
    const state = buildEmptyState();
    state.lastShownDate = "2026-01-01";
    state.dailyShown.cursorDistance = [1, 2];
    state.dailyShown.screenTime = [30];

    const today = "2026-01-02";
    const result = resetDailyIfNeeded(state, today);

    expect(result.lastShownDate).toBe("2026-01-02");
    expect(result.dailyShown.cursorDistance).toEqual([]);
    expect(result.dailyShown.screenTime).toEqual([]);
  });

  it("does not reset when date is the same", () => {
    const state = buildEmptyState();
    state.lastShownDate = "2026-01-01";
    state.dailyShown.cursorDistance = [1, 2];

    const result = resetDailyIfNeeded(state, "2026-01-01");

    expect(result.dailyShown.cursorDistance).toEqual([1, 2]);
  });
});

describe("isOnCooldown", () => {
  it("returns true when last toast was less than 10 minutes ago", () => {
    const state = buildEmptyState();
    state.lastToastTs = Date.now() - 5 * 60 * 1000; // 5 min ago
    expect(isOnCooldown(state)).toBe(true);
  });

  it("returns false when last toast was more than 10 minutes ago", () => {
    const state = buildEmptyState();
    state.lastToastTs = Date.now() - 11 * 60 * 1000; // 11 min ago
    expect(isOnCooldown(state)).toBe(false);
  });

  it("returns false when no toast has been shown", () => {
    const state = buildEmptyState();
    expect(isOnCooldown(state)).toBe(false);
  });
});

describe("recordToastShown", () => {
  it("updates lastToastTs and lastShownDate", () => {
    const state = buildEmptyState();
    const before = Date.now();
    const result = recordToastShown(state, "2026-01-01");
    expect(result.lastToastTs).toBeGreaterThanOrEqual(before);
    expect(result.lastShownDate).toBe("2026-01-01");
  });
});
