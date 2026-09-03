// ABOUTME: Formats time ranges for compact visualization readouts.
// ABOUTME: Keeps minute, hour, and day spans short enough for instrumentation bars.

/** Compact duration for a dataset's actual time bounds. */
export function formatCompactTimeSpan(minTs: number, maxTs: number): string {
  if (!minTs || !maxTs || maxTs <= minTs) return "—";
  const durationMs = maxTs - minTs;
  if (durationMs < 60_000) return "<1m";
  if (durationMs < 60 * 60_000) return `${Math.round(durationMs / 60_000)}m`;
  if (durationMs < 24 * 60 * 60_000) {
    return `${(durationMs / (60 * 60_000)).toFixed(1)}h`;
  }
  return `${(durationMs / (24 * 60 * 60_000)).toFixed(1)}d`;
}
