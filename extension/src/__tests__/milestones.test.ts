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
import {
  pickCopy,
  pxToMiles,
  findNextDailyMilestone,
  findNextAllTimeMilestone,
  findNextDomainMilestone,
} from "../milestones/milestones";

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

describe("pxToMiles", () => {
  it("converts pixels to miles correctly", () => {
    // 1 mile = 5280 ft * 12 in * 96 dpi = 6,082,560 px
    expect(pxToMiles(6082560)).toBeCloseTo(1, 2);
    expect(pxToMiles(0)).toBe(0);
  });
});

describe("pickCopy", () => {
  it("picks a string from the pool", () => {
    const state = buildEmptyState();
    const pool = ["a", "b", "c"];
    const result = pickCopy(pool, "cursorDistance", state);
    expect(pool).toContain(result.copy);
  });

  it("does not repeat the last used index back-to-back", () => {
    const state = buildEmptyState();
    state.lastCopyIndex["cursorDistance"] = 0;
    const pool = ["a", "b", "c"];
    const result = pickCopy(pool, "cursorDistance", state);
    expect(result.copy).not.toBe("a");
  });
});

describe("findNextDailyMilestone", () => {
  it("returns null when no threshold crossed", () => {
    const state = buildEmptyState();
    expect(findNextDailyMilestone("cursorDistance", 0.5, state)).toBeNull();
  });

  it("returns the lowest uncrossed threshold", () => {
    const state = buildEmptyState();
    const result = findNextDailyMilestone("cursorDistance", 3, state);
    expect(result?.threshold).toBe(1);
  });

  it("skips thresholds already shown today", () => {
    const state = buildEmptyState();
    state.dailyShown.cursorDistance = [1];
    const result = findNextDailyMilestone("cursorDistance", 3, state);
    expect(result?.threshold).toBe(2);
  });

  it("returns null when all crossed thresholds already shown", () => {
    const state = buildEmptyState();
    state.dailyShown.cursorDistance = [1, 2];
    expect(findNextDailyMilestone("cursorDistance", 3, state)).toBeNull();
  });
});

describe("findNextAllTimeMilestone", () => {
  it("returns the lowest uncrossed all-time threshold", () => {
    const state = buildEmptyState();
    const result = findNextAllTimeMilestone("sitesExplored", 30, state);
    expect(result?.threshold).toBe(10);
  });

  it("skips already-shown all-time thresholds", () => {
    const state = buildEmptyState();
    state.allTimeShown.sitesExplored = [10];
    const result = findNextAllTimeMilestone("sitesExplored", 30, state);
    expect(result?.threshold).toBe(25);
  });

  it("returns null when value hasn't crossed any threshold", () => {
    const state = buildEmptyState();
    expect(findNextAllTimeMilestone("sitesExplored", 5, state)).toBeNull();
  });
});

describe("findNextDomainMilestone", () => {
  it("returns lowest uncrossed domain visit threshold", () => {
    const state = buildEmptyState();
    const result = findNextDomainMilestone("nytimes.com", 12, state);
    expect(result?.threshold).toBe(10);
  });

  it("skips thresholds already shown for that domain", () => {
    const state = buildEmptyState();
    state.allTimeShown.domainVisits["nytimes.com"] = [10];
    const result = findNextDomainMilestone("nytimes.com", 30, state);
    expect(result?.threshold).toBe(25);
  });
});
