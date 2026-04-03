// ABOUTME: MilestoneState type and browser.storage.local persistence helpers.
// ABOUTME: Handles daily reset at midnight and global cooldown tracking.

import browser from "webextension-polyfill";

export interface MilestoneState {
  /** "YYYY-MM-DD" of last toast shown — used to detect midnight rollover */
  lastShownDate: string;
  dailyShown: {
    /** Miles thresholds already shown today, e.g. [1, 2] */
    cursorDistance: number[];
    /** Screen time thresholds in minutes already shown today, e.g. [30, 60] */
    screenTime: number[];
  };
  allTimeShown: {
    /** Domain count thresholds shown ever */
    sitesExplored: number[];
    /** domain → visit count thresholds shown ever */
    domainVisits: Record<string, number[]>;
  };
  /** Unix ms timestamp of last toast shown — for global 10-min cooldown */
  lastToastTs: number;
  /** Last copy index used per category — avoids back-to-back repeats */
  lastCopyIndex: Partial<Record<string, number>>;
}

const STORAGE_KEY = "milestoneState";
const COOLDOWN_MS = 10 * 60 * 1000;

export function buildEmptyState(): MilestoneState {
  return {
    lastShownDate: "",
    dailyShown: { cursorDistance: [], screenTime: [] },
    allTimeShown: { sitesExplored: [], domainVisits: {} },
    lastToastTs: 0,
    lastCopyIndex: {},
  };
}

export async function loadState(): Promise<MilestoneState> {
  const result = await browser.storage.local.get(STORAGE_KEY);
  const stored = result[STORAGE_KEY];
  if (!stored) return buildEmptyState();
  // Merge with empty state to handle new fields added in future
  return { ...buildEmptyState(), ...stored };
}

export async function saveState(state: MilestoneState): Promise<void> {
  await browser.storage.local.set({ [STORAGE_KEY]: state });
}

/** Returns today's date as "YYYY-MM-DD" in local time */
export function todayString(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Returns a new state with daily counters reset if the date has changed */
export function resetDailyIfNeeded(state: MilestoneState, today: string): MilestoneState {
  if (state.lastShownDate === today) return state;
  return {
    ...state,
    lastShownDate: today,
    dailyShown: { cursorDistance: [], screenTime: [] },
  };
}

export function isOnCooldown(state: MilestoneState): boolean {
  return state.lastToastTs > 0 && Date.now() - state.lastToastTs < COOLDOWN_MS;
}

/** Returns a new state with the toast timestamp and date updated */
export function recordToastShown(state: MilestoneState, today: string): MilestoneState {
  return { ...state, lastToastTs: Date.now(), lastShownDate: today };
}
