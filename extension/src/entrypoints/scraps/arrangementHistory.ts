// ABOUTME: Undo and redo over a collage's arrangement, one step per edit.
// ABOUTME: A continuous gesture coalesces into a single step so undo feels whole.

import type { CollagePiece } from "./collageRecord";

export type Arrangement = readonly CollagePiece[];

export interface ArrangementHistory {
  past: Arrangement[];
  present: Arrangement;
  future: Arrangement[];
  /**
   * Names the run of edits the present belongs to. A drag or a burst of
   * nudges keeps one label, so the whole run undoes as a single step.
   */
  runLabel: string | null;
}

/** How many steps back a collage can be taken. */
export const HISTORY_LIMIT = 100;

export function createHistory(present: Arrangement): ArrangementHistory {
  return { past: [], present, future: [], runLabel: null };
}

/**
 * Records a new arrangement. Passing the same `runLabel` as the previous edit
 * replaces that step instead of adding one, which is what turns a continuous
 * drag into a single undo.
 */
export function recordArrangement(
  history: ArrangementHistory,
  present: Arrangement,
  runLabel: string | null = null,
): ArrangementHistory {
  if (present === history.present) return history;

  const continues = runLabel !== null && runLabel === history.runLabel;
  if (continues) {
    return { ...history, present, future: [], runLabel };
  }

  const past = [...history.past, history.present];
  return {
    past: past.length > HISTORY_LIMIT ? past.slice(past.length - HISTORY_LIMIT) : past,
    present,
    future: [],
    runLabel,
  };
}

/** Ends the current run so the next edit starts a fresh undo step. */
export function endRun(history: ArrangementHistory): ArrangementHistory {
  return history.runLabel === null ? history : { ...history, runLabel: null };
}

export function canUndo(history: ArrangementHistory): boolean {
  return history.past.length > 0;
}

export function canRedo(history: ArrangementHistory): boolean {
  return history.future.length > 0;
}

export function undo(history: ArrangementHistory): ArrangementHistory {
  if (!canUndo(history)) return history;
  const past = [...history.past];
  const present = past.pop() as Arrangement;
  return {
    past,
    present,
    future: [history.present, ...history.future],
    runLabel: null,
  };
}

export function redo(history: ArrangementHistory): ArrangementHistory {
  if (!canRedo(history)) return history;
  const [present, ...future] = history.future;
  return {
    past: [...history.past, history.present],
    present,
    future,
    runLabel: null,
  };
}
