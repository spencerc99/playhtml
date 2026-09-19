// ABOUTME: Calculates smooth visibility transitions for live cursor trails.
// ABOUTME: Preserves the current opacity when a departure reverses into a return.

export const DEPART_FADE_MS = 8000;
export const RETURN_FADE_MS = 4000;

export interface TrailVisibilityTransition {
  startedAt: number;
  fromOpacity: number;
  toOpacity: number;
  durationMs: number;
}

export function getTrailVisibility(
  transition: TrailVisibilityTransition | null,
  clockMs: number,
): number {
  if (transition === null) return 1;

  const progress = Math.max(
    0,
    Math.min(1, (clockMs - transition.startedAt) / transition.durationMs),
  );
  return (
    transition.fromOpacity +
    (transition.toOpacity - transition.fromOpacity) * progress
  );
}

export function startTrailVisibilityTransition(
  current: TrailVisibilityTransition | null,
  clockMs: number,
  visible: boolean,
): TrailVisibilityTransition {
  return {
    startedAt: clockMs,
    fromOpacity: getTrailVisibility(current, clockMs),
    toOpacity: visible ? 1 : 0,
    durationMs: visible ? RETURN_FADE_MS : DEPART_FADE_MS,
  };
}
