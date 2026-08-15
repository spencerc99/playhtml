// ABOUTME: Carries completed cursor trails across archive batch boundaries.
// ABOUTME: Lets the next batch displace prior trails through the normal fade lifecycle.

import { useMemo, useRef } from "react";
import type { TrailState } from "../types";

export type ArchiveTrailHandoffAction =
  | "clear"
  | "clear-and-wait"
  | "retain"
  | "track";

export function selectArchiveTrailHandoffAction(
  previousCycleKey: string,
  cycleKey: string,
  previousContextKey: string,
  contextKey: string,
  contextResetPending: boolean,
): ArchiveTrailHandoffAction {
  if (previousContextKey !== contextKey) {
    return previousCycleKey === cycleKey ? "clear-and-wait" : "clear";
  }
  if (previousCycleKey !== cycleKey) {
    return contextResetPending ? "clear" : "retain";
  }
  return contextResetPending ? "clear-and-wait" : "track";
}

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
  contextKey: string,
  enabled: boolean,
  residueLimit: number,
  completionFadeMs: number,
): TrailState[] {
  const cycleKeyRef = useRef(cycleKey);
  const contextKeyRef = useRef(contextKey);
  const contextResetPendingRef = useRef(false);
  const activeTrailStatesRef = useRef(trailStates);
  const residueRef = useRef<TrailState[]>([]);

  if (!enabled) {
    cycleKeyRef.current = cycleKey;
    contextKeyRef.current = contextKey;
    contextResetPendingRef.current = false;
    activeTrailStatesRef.current = trailStates;
    residueRef.current = [];
  } else {
    const action = selectArchiveTrailHandoffAction(
      cycleKeyRef.current,
      cycleKey,
      contextKeyRef.current,
      contextKey,
      contextResetPendingRef.current,
    );

    if (action === "clear") {
      contextKeyRef.current = contextKey;
      contextResetPendingRef.current = false;
      cycleKeyRef.current = cycleKey;
      activeTrailStatesRef.current = trailStates;
      residueRef.current = [];
    } else if (action === "clear-and-wait") {
      contextKeyRef.current = contextKey;
      contextResetPendingRef.current = true;
      residueRef.current = [];
    } else if (action === "retain") {
      residueRef.current = createCompletedTrailResidue(
        activeTrailStatesRef.current,
        residueLimit,
        completionFadeMs,
      );
      contextResetPendingRef.current = false;
      cycleKeyRef.current = cycleKey;
      activeTrailStatesRef.current = trailStates;
    } else {
      activeTrailStatesRef.current = trailStates;
    }
  }

  return useMemo(
    () =>
      residueRef.current.length > 0
        ? [...residueRef.current, ...trailStates]
        : trailStates,
    [contextKey, cycleKey, enabled, trailStates],
  );
}
