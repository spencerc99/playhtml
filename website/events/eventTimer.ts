// ABOUTME: Computes the shared event stopwatch's elapsed time from its saved room data.
// ABOUTME: Handles rooms saved before startedAt/pausedElapsedMs existed, which only have time and isRunning.

export interface TimerData {
  // Whole seconds shown when the timer was last paused or reset. Rooms saved
  // before startedAt/pausedElapsedMs existed only have this field.
  time: number;
  isRunning: boolean;
  // When the current run started (Date.now()), present only while running.
  startedAt?: number;
  // Milliseconds accumulated before the current run.
  pausedElapsedMs?: number;
}

// A room saved before startedAt existed can say it is running with no start
// time; it counts as paused until someone presses Start.
export function isTimerRunning(data: TimerData): boolean {
  return data.isRunning && typeof data.startedAt === "number";
}

export function timerElapsedMs(data: TimerData, now: number): number {
  const base =
    typeof data.pausedElapsedMs === "number"
      ? data.pausedElapsedMs
      : (data.time ?? 0) * 1000;
  if (data.isRunning && typeof data.startedAt === "number") {
    return base + Math.max(0, now - data.startedAt);
  }
  return base;
}

export function formatTime(totalSeconds: number) {
  const hours = String(Math.floor(totalSeconds / 3600)).padStart(2, "0");
  const minutes = String(Math.floor((totalSeconds % 3600) / 60)).padStart(
    2,
    "0",
  );
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  return `${hours}:${minutes}:${seconds}`;
}
