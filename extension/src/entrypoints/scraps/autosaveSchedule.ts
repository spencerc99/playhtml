// ABOUTME: Decides when a collage's arrangement is written and when it is re-baked.
// ABOUTME: A pure state machine, so the timing is testable without a browser.

/** What the studio tells the person about where their work stands. */
export type SaveStanding =
  | { kind: "untouched" }
  | { kind: "saving" }
  | { kind: "saved" }
  | { kind: "previewBehind"; reason: string }
  | { kind: "failed"; reason: string };

export interface AutosaveState {
  /** A change is waiting for the arrangement to settle. */
  arrangementPending: boolean;
  /** An arrangement write is in flight. */
  writing: boolean;
  /** The preview no longer matches the stored arrangement. */
  previewStale: boolean;
  /** A bake is in flight; its token guards against a stale result landing. */
  bakingToken: number | null;
  /** Bumped by every change, so a bake result can be told it is out of date. */
  revision: number;
  /** The revision the stored arrangement is at, or null before first write. */
  storedRevision: number | null;
  standing: SaveStanding;
  /** Why the last bake could not be drawn, kept so it can be shown. */
  previewProblem: string | null;
  /** Writes that have failed in a row, which sets how long the next retry waits. */
  failedWrites: number;
}

export type AutosaveEvent =
  | { kind: "changed"; hasContent: boolean }
  | { kind: "arrangementSettled" }
  | { kind: "flush" }
  | {
      kind: "writeSucceeded";
      revision: number;
      /**
       * How the picture baked alongside this write went, for a write that
       * baked one first. Omitted when the write carried the previous picture.
       */
      preview?: { drawn: true } | { drawn: false; reason: string };
    }
  | { kind: "writeFailed"; reason: string }
  | { kind: "bakeSucceeded"; token: number }
  | { kind: "bakeFailed"; token: number; reason: string };

/** What the studio should do next, alongside the new state. */
export interface AutosaveAction {
  /** Write the arrangement now, at this revision. */
  write?: { revision: number; needsPreview: boolean };
  /** Start a bake under this token. */
  bake?: { token: number };
  /** Start or restart the settle timer. */
  scheduleSettle?: boolean;
  /** Stop the settle timer, because it has been overtaken. */
  cancelSettle?: boolean;
  /** Try a failed write again after this long, on the settle timer. */
  retryAfterMs?: number;
}

/**
 * How long each retry of a failed write waits: quickly at first, in case the
 * failure was a blip, then every 30 seconds for as long as the studio is open.
 */
export const RETRY_DELAYS_MS = [2000, 5000, 15000, 30000];

export function retryDelayMs(failedWrites: number): number {
  const index = Math.min(failedWrites, RETRY_DELAYS_MS.length) - 1;
  return RETRY_DELAYS_MS[Math.max(index, 0)];
}

export function createAutosaveState(stored: boolean): AutosaveState {
  return {
    arrangementPending: false,
    writing: false,
    previewStale: false,
    bakingToken: null,
    revision: 0,
    storedRevision: stored ? 0 : null,
    standing: stored ? { kind: "saved" } : { kind: "untouched" },
    previewProblem: null,
    failedWrites: 0,
  };
}

/** Whether there is work the person would lose by leaving right now. */
export function hasUnwrittenWork(state: AutosaveState): boolean {
  if (state.standing.kind === "failed") return true;
  if (state.arrangementPending || state.writing) return true;
  return state.storedRevision !== null && state.storedRevision !== state.revision;
}

/**
 * Advances the schedule. The caller owns the timers and the IO; this only says
 * what should happen, so the ordering is the same in a test and in the studio.
 */
export function stepAutosave(
  state: AutosaveState,
  event: AutosaveEvent,
): { state: AutosaveState; action: AutosaveAction } {
  switch (event.kind) {
    case "changed": {
      // A collage with nothing in it is never written, so an untouched new
      // one leaves no trace.
      if (!event.hasContent && state.storedRevision === null) {
        return { state, action: {} };
      }
      return {
        state: {
          ...state,
          revision: state.revision + 1,
          arrangementPending: true,
          previewStale: true,
          // A bake already running is now for an older arrangement.
          bakingToken: null,
          standing: { kind: "saving" },
          // A fresh edit after a failure is retried on its own settle, not
          // after the backoff the failures had built up.
          failedWrites: 0,
        },
        action: { scheduleSettle: true },
      };
    }

    case "arrangementSettled":
    case "flush": {
      if (!state.arrangementPending) {
        // Nothing changed, so a flush must not bump anything.
        return { state, action: { cancelSettle: true } };
      }
      if (state.writing) {
        // The in-flight write is for an older revision; it will come back and
        // the still-pending change will schedule the next one.
        return { state, action: { cancelSettle: true } };
      }
      return {
        state: {
          ...state,
          arrangementPending: false,
          writing: true,
          standing: { kind: "saving" },
        },
        action: {
          cancelSettle: true,
          write: {
            revision: state.revision,
            // The very first write has no preview to fall back on.
            needsPreview: state.storedRevision === null,
          },
        },
      };
    }

    case "writeSucceeded": {
      const caughtUp = event.revision === state.revision;
      if (caughtUp && event.preview) {
        // The picture was drawn for this very arrangement just before the
        // write, so there is nothing to bake again.
        const drawn = event.preview.drawn;
        const problem = event.preview.drawn ? null : event.preview.reason;
        return {
          state: {
            ...state,
            writing: false,
            storedRevision: event.revision,
            failedWrites: 0,
            bakingToken: null,
            previewStale: !drawn,
            previewProblem: problem,
            standing:
              problem === null
                ? { kind: "saved" }
                : { kind: "previewBehind", reason: problem },
          },
          action: {},
        };
      }
      const token = state.revision;
      return {
        state: {
          ...state,
          writing: false,
          storedRevision: event.revision,
          failedWrites: 0,
          bakingToken: caughtUp ? token : state.bakingToken,
          standing: state.previewStale
            ? state.previewProblem
              ? { kind: "previewBehind", reason: state.previewProblem }
              : { kind: "saving" }
            : { kind: "saved" },
        },
        action: caughtUp
          ? { bake: { token } }
          : // More changes arrived while writing, so settle again.
            { scheduleSettle: true },
      };
    }

    case "writeFailed": {
      const failedWrites = state.failedWrites + 1;
      return {
        state: {
          ...state,
          writing: false,
          // The arrangement is still waiting to be written, so a retry, a
          // flush or the next settle all write it again.
          arrangementPending: true,
          failedWrites,
          standing: { kind: "failed", reason: event.reason },
        },
        action: { retryAfterMs: retryDelayMs(failedWrites) },
      };
    }

    case "bakeSucceeded": {
      // A bake for an arrangement that has since moved on is discarded rather
      // than written over the newer one.
      if (state.bakingToken !== event.token) return { state, action: {} };
      return {
        state: {
          ...state,
          bakingToken: null,
          previewStale: false,
          previewProblem: null,
          standing: { kind: "saved" },
        },
        action: {},
      };
    }

    case "bakeFailed": {
      if (state.bakingToken !== event.token) return { state, action: {} };
      return {
        state: {
          ...state,
          bakingToken: null,
          previewProblem: event.reason,
          standing: { kind: "previewBehind", reason: event.reason },
        },
        action: {},
      };
    }
  }
}
