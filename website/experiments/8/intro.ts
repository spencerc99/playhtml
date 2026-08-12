// ABOUTME: Calculates the opening scroll animation for Experiment 8.
// ABOUTME: Keeps the grid-paper introduction timing deterministic and testable.
export const INTRO_SCROLL_DURATION_MS = 2200;
export const INTRO_FADE_DURATION_MS = 500;

export function getIntroScrollY({
  destinationY,
  elapsedMs,
  durationMs = INTRO_SCROLL_DURATION_MS,
}: {
  destinationY: number;
  elapsedMs: number;
  durationMs?: number;
}): number {
  if (destinationY < 0) {
    throw new RangeError("destinationY must be non-negative");
  }
  if (elapsedMs < 0) {
    throw new RangeError("elapsedMs must be non-negative");
  }
  if (durationMs <= 0) return destinationY;

  const progress = Math.min(elapsedMs / durationMs, 1);
  const easedProgress =
    progress < 0.5
      ? 4 * progress * progress * progress
      : 1 - Math.pow(-2 * progress + 2, 3) / 2;

  return destinationY * easedProgress;
}
