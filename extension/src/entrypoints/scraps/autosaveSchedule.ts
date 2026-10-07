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
}

export type AutosaveEvent =
  | { kind: "changed"; hasContent: boolean }
  | { kind: "arrangementSettled" }
  | { kind: "flush" }
  | { kind: "writeSucceeded"; revision: number }
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
      const token = state.revision;
      return {
        state: {
          ...state,
          writing: false,
          storedRevision: event.revision,
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

    case "writeFailed":
      return {
        state: {
          ...state,
          writing: false,
          standing: { kind: "failed", reason: event.reason },
        },
        action: {},
      };

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
