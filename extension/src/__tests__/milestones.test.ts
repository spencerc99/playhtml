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
  checkAllMilestones,
  detectLongGapReturn,
  formatGap,
  LONG_GAP_THRESHOLD_MS,
} from "../milestones/milestones";

const DAY_MS = 24 * 60 * 60 * 1000;

describe("buildEmptyState", () => {
  it("returns a valid empty state", () => {
    const state = buildEmptyState();
    expect(state.lastShownDate).toBe("");
    expect(state.dailyShown.cursorDistance).toEqual([]);
    expect(state.dailyShown.screenTime).toEqual([]);
    expect(state.allTimeShown.sitesExplored).toEqual([]);
    expect(state.allTimeShown.domainVisits).toEqual({});
    expect(state.allTimeShown.longGapReturn).toEqual({});
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

describe("checkAllMilestones", () => {
  it("returns null when no milestones are ready", () => {
    const state = buildEmptyState();
    const result = checkAllMilestones(
      state,
      { domainCount: 0, hourBuckets: Array(24).fill(0) },
      0,
      [],
    );
    expect(result).toBeNull();
  });

  it("fires cursorDistance milestone when threshold crossed", () => {
    const state = buildEmptyState();
    // 1 mile = 6,082,560 px
    const result = checkAllMilestones(
      state,
      { domainCount: 0, hourBuckets: Array(24).fill(0) },
      6082560, // 1 mile
      [],
    );
    expect(result).not.toBeNull();
    expect(result!.milestone.type).toBe("cursorDistance");
    expect(result!.milestone.threshold).toBe(1);
    expect(result!.updatedState.dailyShown.cursorDistance).toContain(1);
  });

  it("fires screenTime milestone when cursor already shown", () => {
    const state = { ...buildEmptyState(), dailyScreenTimeMs: 31 * 60 * 1000 };
    state.dailyShown.cursorDistance = [1]; // cursor already fired
    const result = checkAllMilestones(
      state,
      { domainCount: 0, hourBuckets: Array(24).fill(0) },
      6082560, // 1 mile — but already shown
      [],
    );
    expect(result).not.toBeNull();
    expect(result!.milestone.type).toBe("screenTime");
    expect(result!.milestone.threshold).toBe(30);
  });

  it("fires domainVisits milestone for top domain", () => {
    const state = buildEmptyState();
    // cursor and screen time not crossed
    const result = checkAllMilestones(
      state,
      { domainCount: 0, hourBuckets: Array(24).fill(0) },
      0,
      [{ domain: "example.com", visitCount: 10 }],
    );
    expect(result).not.toBeNull();
    expect(result!.milestone.type).toBe("domainVisits");
    expect(result!.milestone.domain).toBe("example.com");
    expect(result!.updatedState.allTimeShown.domainVisits["example.com"]).toContain(10);
  });

  it("updatedState has the fired threshold recorded", () => {
    const state = buildEmptyState();
    const result = checkAllMilestones(
      state,
      { domainCount: 0, hourBuckets: Array(24).fill(0) },
      6082560,
      [],
    );
    expect(result!.updatedState.dailyShown.cursorDistance).toEqual([1]);
  });
});

describe("detectLongGapReturn", () => {
  const now = new Date("2026-07-16T12:00:00Z").getTime();

  it("returns null when the gap is under 30 days (29 days)", () => {
    const result = detectLongGapReturn([now, now - 29 * DAY_MS], now);
    expect(result).toBeNull();
  });

  it("fires when the gap exceeds 30 days (31 days)", () => {
    const previousVisitTs = now - 31 * DAY_MS;
    const result = detectLongGapReturn([now, previousVisitTs], now);
    expect(result).not.toBeNull();
    expect(result!.returnTs).toBe(now);
    expect(result!.previousVisitTs).toBe(previousVisitTs);
    expect(result!.gapMs).toBeGreaterThan(LONG_GAP_THRESHOLD_MS);
  });

  it("returns null when the newest visit is stale (not a recent return)", () => {
    // Newest visit is 2 days ago — outside the 24h recency window.
    const result = detectLongGapReturn(
      [now - 2 * DAY_MS, now - 200 * DAY_MS],
      now,
    );
    expect(result).toBeNull();
  });

  it("finds the long gap after several visits earlier on the return day", () => {
    const previousVisitTs = now - 120 * DAY_MS;
    const result = detectLongGapReturn(
      [
        now - 60 * 60 * 1000,
        previousVisitTs - 2 * DAY_MS,
        now - 3 * 60 * 60 * 1000,
        previousVisitTs,
        now - 2 * 60 * 60 * 1000,
      ],
      now,
    );

    expect(result).not.toBeNull();
    expect(result!.returnTs).toBe(now - 3 * 60 * 60 * 1000);
    expect(result!.previousVisitTs).toBe(previousVisitTs);
    expect(result!.gapMs).toBe(120 * DAY_MS - 3 * 60 * 60 * 1000);
  });

  it("collects up to 4 distinct previous visit days, newest first, deduped", () => {
    const ts = (daysAgo: number, hour = 12) =>
      now - daysAgo * DAY_MS + hour * 60 * 60 * 1000;
    const events = [
      now, // the return
      ts(120), // previous visit before the gap
      ts(120, 13), // same day as above — should dedupe
      ts(125),
      ts(130),
      ts(140),
      ts(150), // 5th distinct day — should be dropped
    ];
    const result = detectLongGapReturn(events, now);
    expect(result).not.toBeNull();
    expect(result!.previousVisits.length).toBe(4);
    // Newest-first ordering
    const pv = result!.previousVisits;
    expect(pv[0]).toBeGreaterThan(pv[1]);
    expect(pv[1]).toBeGreaterThan(pv[2]);
    expect(pv[2]).toBeGreaterThan(pv[3]);
  });

  it("returns null for a single visit (no pair to compare)", () => {
    expect(detectLongGapReturn([now], now)).toBeNull();
    expect(detectLongGapReturn([], now)).toBeNull();
  });
});

describe("formatGap", () => {
  it("uses weeks under 60 days", () => {
    expect(formatGap(31 * DAY_MS)).toBe("4wks");
    expect(formatGap(45 * DAY_MS)).toBe("6wks");
  });

  it("uses months from 60 through 729 days", () => {
    expect(formatGap(97 * DAY_MS)).toBe("3mo");
    expect(formatGap(465 * DAY_MS)).toBe("15mo");
  });

  it("uses years at or above 730 days", () => {
    expect(formatGap(800 * DAY_MS)).toBe("2yr");
  });
});

describe("checkAllMilestones — longGapReturn", () => {
  const now = Date.now();
  const gap = {
    domain: "dearkellyfilm.com",
    faviconUrl: "https://example.com/fav.png",
    return: {
      returnTs: now,
      previousVisitTs: now - 120 * DAY_MS,
      gapMs: 120 * DAY_MS,
      previousVisits: [now - 120 * DAY_MS, now - 125 * DAY_MS],
    },
  };

  it("fires before other ready milestones", () => {
    const state = { ...buildEmptyState(), dailyScreenTimeMs: 60 * 60 * 1000 };
    const result = checkAllMilestones(
      state,
      { domainCount: 500, hourBuckets: Array(24).fill(0) },
      6082560, // cursor distance also crossed
      [{ domain: "dearkellyfilm.com", visitCount: 100 }],
      gap,
    );
    expect(result).not.toBeNull();
    expect(result!.milestone.type).toBe("longGapReturn");
    expect(result!.milestone.domain).toBe("dearkellyfilm.com");
    expect(result!.milestone.copy).toContain("last");
    expect(result!.milestone.previousVisits).toEqual(gap.return.previousVisits);
    expect(
      result!.updatedState.allTimeShown.longGapReturn["dearkellyfilm.com"],
    ).toBe(gap.return.previousVisitTs);
  });

  it("does not fire the same gap twice for a domain", () => {
    const state = buildEmptyState();
    state.allTimeShown.longGapReturn["dearkellyfilm.com"] =
      gap.return.previousVisitTs;
    const result = checkAllMilestones(
      state,
      { domainCount: 0, hourBuckets: Array(24).fill(0) },
      0,
      [],
      gap,
    );
    expect(result).toBeNull();
  });

  it("fires again for a new, later gap on the same domain", () => {
    const state = buildEmptyState();
    // Previously shown an older gap.
    state.allTimeShown.longGapReturn["dearkellyfilm.com"] = now - 400 * DAY_MS;
    const result = checkAllMilestones(
      state,
      { domainCount: 0, hourBuckets: Array(24).fill(0) },
      0,
      [],
      gap,
    );
    expect(result).not.toBeNull();
    expect(result!.milestone.type).toBe("longGapReturn");
  });

  it("does not fire when no long gap is passed", () => {
    const state = buildEmptyState();
    const result = checkAllMilestones(
      state,
      { domainCount: 0, hourBuckets: Array(24).fill(0) },
      0,
      [],
      null,
    );
    expect(result).toBeNull();
  });
});
