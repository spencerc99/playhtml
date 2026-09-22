// ABOUTME: Runs the collage autosave schedule: timers, the write, and the re-bake.
// ABOUTME: The studio says what changed; this decides when the drawer and the picture catch up.

import { useCallback, useEffect, useRef, useState } from "react";
import {
  createAutosaveState,
  hasUnwrittenWork,
  stepAutosave,
  type AutosaveAction,
  type AutosaveEvent,
  type AutosaveState,
  type SaveStanding,
} from "./autosaveSchedule";
import type { CollageRecord } from "./collageRecord";

/** How long the arrangement rests before it is written. */
export const SETTLE_DELAY_MS = 1200;

/** Timers the schedule runs on, injected so a test can drive them directly. */
export interface AutosaveTimers {
  setTimer: (run: () => void, delayMs: number) => number;
  clearTimer: (handle: number) => void;
}

const WINDOW_TIMERS: AutosaveTimers = {
  setTimer: (run, delayMs) => window.setTimeout(run, delayMs),
  clearTimer: (handle) => window.clearTimeout(handle),
};

export interface CollageDraft {
  /** The record as it stands, without a preview; the schedule supplies that. */
  record: Omit<CollageRecord, "preview">;
  /** Whether there is anything worth storing at all. */
  hasContent: boolean;
}

export interface CollageAutosaveOptions {
  /** Reads the collage as it stands right now, at the moment of the write. */
  draft: () => CollageDraft;
  /** Draws the preview for the current arrangement. */
  bake: () => Promise<Blob>;
  /** Stores the record. */
  store: (record: CollageRecord) => Promise<void>;
  /** Told after every landed write, so history can refresh. */
  onStored: (record: CollageRecord) => void;
  /** Whether this studio opened on a collage that is already in the drawer. */
  startsStored: boolean;
  /**
   * The collage this studio opened on, when it opened on a stored one. Its
   * picture is the last one known to have drawn, so arrangement writes carry
   * it until a new bake succeeds rather than blanking the card in between.
   */
  reopening?: CollageRecord | null;
  timers?: AutosaveTimers;
}

export interface CollageAutosave {
  standing: SaveStanding;
  /** Whether leaving now would lose work. */
  unwritten: boolean;
  /** Notes that something about the collage changed. */
  noteChange: () => void;
  /** Writes right now, without waiting for the settle. */
  flush: () => void;
}

/**
 * The preview a collage keeps between bakes. Holding the last good one means a
 * failed bake costs the person nothing: the arrangement still lands and the
 * picture they already had stays on the card.
 */
function previewFor(
  baked: Blob | null,
  problem: string | null,
): CollageRecord["preview"] {
  if (baked) return { drawn: true, image: baked };
  return {
    drawn: false,
    reason: problem ?? "this collage has not been drawn yet",
  };
}

export function useCollageAutosave(
  options: CollageAutosaveOptions,
): CollageAutosave {
  const timers = options.timers ?? WINDOW_TIMERS;
  const [standing, setStanding] = useState<SaveStanding>(() =>
    options.startsStored ? { kind: "saved" } : { kind: "untouched" },
  );
  const [unwritten, setUnwritten] = useState(false);

  const stateRef = useRef<AutosaveState>(createAutosaveState(options.startsStored));
  const settleRef = useRef<number | null>(null);
  /**
   * The last preview that actually drew, carried across arrangement writes. A
   * reopened collage starts from the picture it was loaded with, so the first
   * edit writes the arrangement without discarding a picture that still draws.
   */
  const reopened = options.reopening ?? null;
  const loadedPreview =
    reopened?.preview.drawn === true ? reopened.preview.image : null;
  const previewRef = useRef<Blob | null>(loadedPreview);
  const previewProblemRef = useRef<string | null>(null);
  /**
   * Exactly what is in the drawer. A preview is written back onto this rather
   * than onto the live draft, so a bake landing late never drags a newer
   * arrangement into the drawer behind the schedule's back.
   */
  const storedRef = useRef<CollageRecord | null>(reopened);
  // The callbacks are read through refs so the dispatch loop never has to be
  // rebuilt when the studio re-renders, which would restart the timers.
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const dispatchRef = useRef<(event: AutosaveEvent) => void>(() => {});

  const cancelSettle = useCallback(() => {
    if (settleRef.current !== null) {
      timers.clearTimer(settleRef.current);
      settleRef.current = null;
    }
  }, [timers]);

  const perform = useCallback(
    (action: AutosaveAction) => {
      if (action.cancelSettle) cancelSettle();
      if (action.scheduleSettle) {
        cancelSettle();
        settleRef.current = timers.setTimer(() => {
          settleRef.current = null;
          dispatchRef.current({ kind: "arrangementSettled" });
        }, SETTLE_DELAY_MS);
      }

      if (action.write) {
        const { revision, needsPreview } = action.write;
        void (async () => {
          try {
            // The first write has nothing to fall back on, so it bakes first
            // and stores the picture alongside the arrangement.
            if (needsPreview) {
              try {
                previewRef.current = await optionsRef.current.bake();
                previewProblemRef.current = null;
              } catch (error) {
                previewProblemRef.current = describe(error);
              }
            }
            const { record } = optionsRef.current.draft();
            const stored: CollageRecord = {
              ...record,
              preview: previewFor(previewRef.current, previewProblemRef.current),
            };
            await optionsRef.current.store(stored);
            storedRef.current = stored;
            optionsRef.current.onStored(stored);
            dispatchRef.current({ kind: "writeSucceeded", revision });
            if (needsPreview && previewProblemRef.current) {
              // The arrangement landed; only the picture is behind.
              dispatchRef.current({
                kind: "bakeFailed",
                token: revision,
                reason: previewProblemRef.current,
              });
            }
          } catch (error) {
            dispatchRef.current({
              kind: "writeFailed",
              reason: describe(error),
            });
          }
        })();
      }

      if (action.bake) {
        const { token } = action.bake;
        void (async () => {
          try {
            const baked = await optionsRef.current.bake();
            previewRef.current = baked;
            previewProblemRef.current = null;
            const written = storedRef.current;
            if (!written) {
              throw new Error(
                "A preview was drawn for a collage that has not been stored",
              );
            }
            // Only the picture is written in. The arrangement and its
            // `updatedAt` are the ones that already landed, so a re-bake never
            // counts as a change to the collage itself.
            const stored: CollageRecord = {
              ...written,
              preview: { drawn: true, image: baked },
            };
            await optionsRef.current.store(stored);
            storedRef.current = stored;
            optionsRef.current.onStored(stored);
            dispatchRef.current({ kind: "bakeSucceeded", token });
          } catch (error) {
            previewProblemRef.current = describe(error);
            dispatchRef.current({
              kind: "bakeFailed",
              token,
              reason: describe(error),
            });
          }
        })();
      }
    },
    [cancelSettle, timers],
  );

  const dispatch = useCallback(
    (event: AutosaveEvent) => {
      const { state, action } = stepAutosave(stateRef.current, event);
      stateRef.current = state;
      setStanding(state.standing);
      setUnwritten(hasUnwrittenWork(state));
      perform(action);
    },
    [perform],
  );
  dispatchRef.current = dispatch;

  const noteChange = useCallback(() => {
    dispatchRef.current({
      kind: "changed",
      hasContent: optionsRef.current.draft().hasContent,
    });
  }, []);

  const flush = useCallback(() => {
    dispatchRef.current({ kind: "flush" });
  }, []);

  useEffect(() => () => cancelSettle(), [cancelSettle]);

  return { standing, unwritten, noteChange, flush };
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
