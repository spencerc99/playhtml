// ABOUTME: Reloads long-running installation pages when their local calendar day changes.
// ABOUTME: Recalculates each midnight boundary so daylight-saving transitions stay correct.

import { useEffect } from "react";

const reloadCurrentPage = () => window.location.reload();
const currentDate = () => new Date();

export function localDateKey(date: Date): string {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

export function millisecondsUntilNextLocalDay(now: Date): number {
  const nextDay = new Date(now);
  nextDay.setHours(24, 0, 0, 0);
  return Math.max(1, nextDay.getTime() - now.getTime());
}

export function useDailyPageReload(
  reloadPage: () => void = reloadCurrentPage,
  now: () => Date = currentDate,
): void {
  useEffect(() => {
    let active = true;
    let timer: number | undefined;
    let currentDateKey = localDateKey(now());

    const scheduleNextDay = () => {
      if (timer !== undefined) window.clearTimeout(timer);
      const currentTime = now();
      timer = window.setTimeout(
        handleDayBoundary,
        millisecondsUntilNextLocalDay(currentTime),
      );
    };

    const reloadIfDayChanged = () => {
      const nextDate = localDateKey(now());
      if (nextDate === currentDateKey) return;
      currentDateKey = nextDate;
      reloadPage();
    };

    function handleDayBoundary() {
      if (!active) return;
      reloadIfDayChanged();
      scheduleNextDay();
    }

    const handleVisibilityChange = () => {
      if (document.visibilityState !== "visible") return;
      reloadIfDayChanged();
      scheduleNextDay();
    };

    scheduleNextDay();
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      active = false;
      if (timer !== undefined) window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [now, reloadPage]);
}
