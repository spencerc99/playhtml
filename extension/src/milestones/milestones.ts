// ABOUTME: Milestone threshold definitions and the check logic that determines
// ABOUTME: which milestone (if any) to fire on each 5-minute alarm tick.

import { MILESTONE_COPY } from "./copy";
import type { MilestoneState } from "./state";

// 1 mile = 5280 ft × 12 in/ft × 96 px/in
const PX_PER_MILE = 5280 * 12 * 96;

export function pxToMiles(px: number): number {
  return px / PX_PER_MILE;
}

export const DAILY_THRESHOLDS = {
  cursorDistance: [1, 2, 5, 10, 25], // miles
  screenTime: [30, 60, 120, 240, 480], // minutes
} as const;

export const ALLTIME_THRESHOLDS = {
  sitesExplored: [10, 25, 50, 100, 250, 500], // unique domains
} as const;

export const DOMAIN_VISIT_THRESHOLDS = [10, 25, 50, 100];

export interface MilestoneFired {
  type: "cursorDistance" | "screenTime" | "sitesExplored" | "domainVisits";
  threshold: number;
  /** The display value (miles, "2h 14m", domain count, visit count) */
  displayValue: string;
  copy: string;
  /** CTA label */
  ctaLabel: string;
  /** Message type to send to content script for CTA action */
  ctaAction: "TOGGLE_HISTORICAL_OVERLAY" | "OPEN_PORTRAIT";
  /** For domain visits — the domain name */
  domain?: string;
  /** For domain visits — favicon URL if available */
  faviconUrl?: string;
  /** "today" or "alltime" — controls badge color */
  period: "today" | "alltime";
  /** Sparkline data for screen time: 7 values 0-1 normalized */
  sparkline?: number[];
}

/** Pick a random copy string, avoiding back-to-back repeats */
export function pickCopy(
  pool: readonly string[],
  key: string,
  state: MilestoneState,
): { copy: string; newIndex: number } {
  const last = state.lastCopyIndex[key] ?? -1;
  const candidates = pool
    .map((c, i) => ({ c, i }))
    .filter(({ i }) => i !== last);
  const chosen = candidates[Math.floor(Math.random() * candidates.length)];
  return { copy: chosen.c, newIndex: chosen.i };
}

/** Find the lowest uncrossed daily threshold for cursorDistance or screenTime */
export function findNextDailyMilestone(
  type: "cursorDistance" | "screenTime",
  value: number,
  state: MilestoneState,
): { threshold: number } | null {
  const thresholds = DAILY_THRESHOLDS[type];
  const shown = state.dailyShown[type];
  for (const t of thresholds) {
    if (value >= t && !shown.includes(t)) {
      return { threshold: t };
    }
  }
  return null;
}

/** Find the lowest uncrossed all-time threshold for sitesExplored */
export function findNextAllTimeMilestone(
  type: "sitesExplored",
  value: number,
  state: MilestoneState,
): { threshold: number } | null {
  const thresholds = ALLTIME_THRESHOLDS[type];
  const shown = state.allTimeShown[type];
  for (const t of thresholds) {
    if (value >= t && !shown.includes(t)) {
      return { threshold: t };
    }
  }
  return null;
}

/** Find the lowest uncrossed domain visit threshold for a specific domain */
export function findNextDomainMilestone(
  domain: string,
  visitCount: number,
  state: MilestoneState,
): { threshold: number } | null {
  const shown = state.allTimeShown.domainVisits[domain] ?? [];
  for (const t of DOMAIN_VISIT_THRESHOLDS) {
    if (visitCount >= t && !shown.includes(t)) {
      return { threshold: t };
    }
  }
  return null;
}

function formatScreenTime(ms: number): string {
  const totalMin = Math.floor(ms / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

/** Normalize hourBuckets to 0-1 for sparkline, taking last 7 hours */
function buildSparkline(hourBuckets: number[]): number[] {
  const hour = new Date().getHours();
  const slice: number[] = [];
  for (let i = 6; i >= 0; i--) {
    slice.push(hourBuckets[(hour - i + 24) % 24] ?? 0);
  }
  const max = Math.max(...slice, 1);
  return slice.map((v) => v / max);
}

/**
 * Check all milestone types given current stats. Returns the first
 * milestone ready to fire, or null if none are ready.
 */
export function checkAllMilestones(
  state: MilestoneState,
  globalStats: {
    domainCount: number;
    hourBuckets: number[];
  },
  cursorDistancePx: number,
  topDomains: Array<{ domain: string; visitCount: number; faviconUrl?: string }>,
): { milestone: MilestoneFired; updatedState: MilestoneState } | null {
  const miles = pxToMiles(cursorDistancePx);

  // 1. Cursor distance (daily)
  const cursorHit = findNextDailyMilestone("cursorDistance", miles, state);
  if (cursorHit) {
    const { copy, newIndex } = pickCopy(MILESTONE_COPY.cursorDistance, "cursorDistance", state);
    return {
      milestone: {
        type: "cursorDistance",
        threshold: cursorHit.threshold,
        displayValue: `${miles.toFixed(1)} mi`,
        copy,
        ctaLabel: "see your trail",
        ctaAction: "TOGGLE_HISTORICAL_OVERLAY",
        period: "today",
      },
      updatedState: {
        ...state,
        dailyShown: {
          ...state.dailyShown,
          cursorDistance: [...state.dailyShown.cursorDistance, cursorHit.threshold],
        },
        lastCopyIndex: { ...state.lastCopyIndex, cursorDistance: newIndex },
      },
    };
  }

  // 2. Screen time (daily) — uses state.dailyScreenTimeMs, computed fresh each tick
  const screenMinutes = state.dailyScreenTimeMs / 60000;
  const screenHit = findNextDailyMilestone("screenTime", screenMinutes, state);
  if (screenHit) {
    const { copy, newIndex } = pickCopy(MILESTONE_COPY.screenTime, "screenTime", state);
    return {
      milestone: {
        type: "screenTime",
        threshold: screenHit.threshold,
        displayValue: formatScreenTime(state.dailyScreenTimeMs),
        copy,
        ctaLabel: "see your day",
        ctaAction: "TOGGLE_HISTORICAL_OVERLAY",
        period: "today",
        sparkline: buildSparkline(globalStats.hourBuckets),
      },
      updatedState: {
        ...state,
        dailyShown: {
          ...state.dailyShown,
          screenTime: [...state.dailyShown.screenTime, screenHit.threshold],
        },
        lastCopyIndex: { ...state.lastCopyIndex, screenTime: newIndex },
      },
    };
  }

  // 3. Sites explored (all-time) — unique domains, not pages
  const sitesHit = findNextAllTimeMilestone("sitesExplored", globalStats.domainCount, state);
  if (sitesHit) {
    const { copy, newIndex } = pickCopy(MILESTONE_COPY.sitesExplored, "sitesExplored", state);
    return {
      milestone: {
        type: "sitesExplored",
        threshold: sitesHit.threshold,
        displayValue: `${globalStats.domainCount}`,
        copy,
        ctaLabel: "see your portrait",
        ctaAction: "OPEN_PORTRAIT",
        period: "alltime",
      },
      updatedState: {
        ...state,
        allTimeShown: {
          ...state.allTimeShown,
          sitesExplored: [...state.allTimeShown.sitesExplored, sitesHit.threshold],
        },
        lastCopyIndex: { ...state.lastCopyIndex, sitesExplored: newIndex },
      },
    };
  }

  // 4. Domain visits (all-time, per domain)
  for (const { domain, visitCount, faviconUrl } of topDomains) {
    const domainHit = findNextDomainMilestone(domain, visitCount, state);
    if (domainHit) {
      const { copy, newIndex } = pickCopy(MILESTONE_COPY.domainVisits, "domainVisits", state);
      const domainShown = state.allTimeShown.domainVisits[domain] ?? [];
      return {
        milestone: {
          type: "domainVisits",
          threshold: domainHit.threshold,
          displayValue: `${visitCount}×`,
          copy,
          ctaLabel: "see your history there",
          ctaAction: "TOGGLE_HISTORICAL_OVERLAY",
          period: "alltime",
          domain,
          faviconUrl,
        },
        updatedState: {
          ...state,
          allTimeShown: {
            ...state.allTimeShown,
            domainVisits: {
              ...state.allTimeShown.domainVisits,
              [domain]: [...domainShown, domainHit.threshold],
            },
          },
          lastCopyIndex: { ...state.lastCopyIndex, domainVisits: newIndex },
        },
      };
    }
  }

  return null;
}
