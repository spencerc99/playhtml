// ABOUTME: Local-time helpers shared by every surface that filters by day or time of day.
// ABOUTME: Matches timestamps against a recurring window that may wrap past midnight.

import type { TimeOfDayFilter } from "../config";

const MINUTES_PER_DAY = 1440;

/** The viewer's local calendar day for a timestamp, as "YYYY-MM-DD". */
export function localDayKey(ts: number): string {
  const d = new Date(ts);
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, "0"),
    String(d.getDate()).padStart(2, "0"),
  ].join("-");
}

/**
 * Whether a timestamp's LOCAL time of day falls inside the window, measured
 * the shortest way around the 24h clock so a midnight window (center 0)
 * matches both 23:50 and 00:10.
 */
export function timeOfDayMatches(ts: number, window: TimeOfDayFilter): boolean {
  const d = new Date(ts);
  const minutesOfDay = d.getHours() * 60 + d.getMinutes();
  let diff = Math.abs(minutesOfDay - window.centerMinutes);
  if (diff > MINUTES_PER_DAY / 2) diff = MINUTES_PER_DAY - diff;
  return diff <= window.radiusMinutes;
}

/** minutes-from-midnight → "HH:MM", wrapping values outside one day. */
export function minutesToHHMM(mins: number): string {
  const m =
    ((Math.round(mins) % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return `${String(h).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

/** "HH:MM" → minutes-from-midnight, or null if unparseable. */
export function hhmmToMinutes(value: string): number | null {
  const m = value.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = Number(m[1]);
  const mm = Number(m[2]);
  if (h > 23 || mm > 59) return null;
  return h * 60 + mm;
}

/** The window's local start and end as "HH:MM–HH:MM". */
export function formatTimeOfDay(window: TimeOfDayFilter): string {
  return `${minutesToHHMM(window.centerMinutes - window.radiusMinutes)}–${minutesToHHMM(
    window.centerMinutes + window.radiusMinutes,
  )}`;
}
