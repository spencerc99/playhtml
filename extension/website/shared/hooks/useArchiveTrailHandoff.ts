// ABOUTME: Carries completed cursor trails across archive batch boundaries.
// ABOUTME: Lets the next batch displace prior trails through the normal fade lifecycle.

import { useMemo, useRef } from "react";
import type { TrailState } from "../types";

export function createCompletedTrailResidue(
  trailStates: TrailState[],
  limit: number,
  completionFadeMs: number,
): TrailState[] {
  if (limit <= 0) return [];

  return [...trailStates]
    .sort(
      (a, b) =>
        a.startOffsetMs + a.durationMs - (b.startOffsetMs + b.durationMs),
    )
    .slice(-limit)
    .map((trailState) => ({
      ...trailState,
      startOffsetMs: -trailState.durationMs - completionFadeMs,
    }));
}

export function useArchiveTrailHandoff(
  trailStates: TrailState[],
  cycleKey: string,
  enabled: boolean,
  residueLimit: number,
  completionFadeMs: number,
): TrailState[] {
  const cycleKeyRef = useRef(cycleKey);
  const activeTrailStatesRef = useRef(trailStates);
  const residueRef = useRef<TrailState[]>([]);

  if (!enabled) {
    cycleKeyRef.current = cycleKey;
    activeTrailStatesRef.current = trailStates;
    residueRef.current = [];
  } else if (cycleKeyRef.current !== cycleKey) {
    residueRef.current = createCompletedTrailResidue(
      activeTrailStatesRef.current,
      residueLimit,
      completionFadeMs,
    );
    cycleKeyRef.current = cycleKey;
    activeTrailStatesRef.current = trailStates;
  } else {
    activeTrailStatesRef.current = trailStates;
  }

  return useMemo(
    () =>
      residueRef.current.length > 0
        ? [...residueRef.current, ...trailStates]
        : trailStates,
    [cycleKey, enabled, trailStates],
  );
}
