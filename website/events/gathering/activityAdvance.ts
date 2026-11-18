// ABOUTME: Decides when a gathering tab writes the advance to the next group activity.
// ABOUTME: Only an admin tab writes, once per activity, so open tabs do not all advance at once.

export const ActivityDurationSeconds = 30;

export function activitySecondsLeft(lastChangeTime: number, now: number) {
  const elapsed = Math.floor((now - lastChangeTime) / 1000);
  return ActivityDurationSeconds - elapsed;
}

// advancedFrom is the lastChangeTime this tab already advanced from, so it
// does not write again before its own advance syncs back.
export function shouldWriteActivityAdvance({
  lastChangeTime,
  now,
  isAdmin,
  advancedFrom,
}: {
  lastChangeTime: number;
  now: number;
  isAdmin: boolean;
  advancedFrom: number | null;
}): boolean {
  return (
    activitySecondsLeft(lastChangeTime, now) <= 0 &&
    isAdmin &&
    advancedFrom !== lastChangeTime
  );
}
