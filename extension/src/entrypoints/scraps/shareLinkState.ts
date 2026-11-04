// ABOUTME: Decides what a collage's share link is doing: sharing, updating in place, unsharing, or waiting.
// ABOUTME: A pure state machine, so when a link catches up with its collage is testable without a browser.

/** How long the collage stays still before its link updates. */
export const LINK_SETTLE_MS = 4000;
/**
 * The least time between two updates of one link, inside what the share
 * server allows (ten a minute per link).
 */
export const LINK_UPDATE_GAP_MS = 8000;

/** The one request the link can have in flight at a time. */
export type LinkWork = "idle" | "sharing" | "updating" | "unsharing";

export interface ShareLinkState {
  work: LinkWork;
  /** The link was just put on the clipboard, so the popover says so. */
  copied: boolean;
  /** The collage or its signature no longer matches what the link shows. */
  stale: boolean;
  /** The content that last failed to go up; it is not retried until it changes. */
  failedKey: string | null;
  /** When the link last went up, so updates keep inside the server's limit. */
  lastUpdateAt: number;
}

/**
 * A look at the collage against its link. `key` is null when the link should
 * not follow the collage right now: there is no link, the maker is still
 * loading, or the collage cannot be shared.
 */
export interface LinkCheck {
  key: string | null;
  publishedKey: string | undefined;
  now: number;
}

export type ShareLinkEvent =
  | { kind: "shareStarted" }
  /** `at` is when the link went up; `copied` whether it reached the clipboard. */
  | { kind: "shareSucceeded"; at: number; copied: boolean }
  | { kind: "shareFailed" }
  | { kind: "updateStarted"; at: number }
  | { kind: "updateSucceeded" }
  | { kind: "updateFailed"; key: string | null }
  | { kind: "unshareStarted" }
  | { kind: "unshareFinished" }
  | { kind: "copied"; ok: boolean }
  | ({ kind: "checked" } & LinkCheck);

export function createShareLinkState(): ShareLinkState {
  return {
    work: "idle",
    copied: false,
    stale: false,
    failedKey: null,
    lastUpdateAt: 0,
  };
}

/**
 * Compares the collage with its link. Returns the state that follows and, when
 * the link should catch up, how long to wait before updating it.
 */
export function checkLink(
  state: ShareLinkState,
  check: LinkCheck,
): { state: ShareLinkState; updateInMs: number | null } {
  const withStale = (stale: boolean): ShareLinkState =>
    state.stale === stale ? state : { ...state, stale };

  if (check.key === null || check.key === check.publishedKey) {
    return { state: withStale(false), updateInMs: null };
  }
  const stale = withStale(true);
  // One request at a time, and a failed upload is not retried as it was.
  if (state.work !== "idle" || check.key === state.failedKey) {
    return { state: stale, updateInMs: null };
  }
  // An edit after a failed update clears it, so the status stops saying so;
  // the next check then schedules the update.
  if (state.failedKey !== null) {
    return { state: { ...stale, failedKey: null }, updateInMs: null };
  }
  return {
    state: stale,
    updateInMs: Math.max(
      LINK_SETTLE_MS,
      state.lastUpdateAt + LINK_UPDATE_GAP_MS - check.now,
    ),
  };
}

/** Advances the link. Events that do not fit the current work are ignored. */
export function stepShareLink(
  state: ShareLinkState,
  event: ShareLinkEvent,
): ShareLinkState {
  switch (event.kind) {
    case "shareStarted":
      if (state.work !== "idle") return state;
      return { ...state, work: "sharing", copied: false };
    case "shareSucceeded":
      if (state.work !== "sharing") return state;
      return {
        ...state,
        work: "idle",
        lastUpdateAt: event.at,
        copied: event.copied,
      };
    case "shareFailed":
      if (state.work !== "sharing") return state;
      return { ...state, work: "idle" };

    case "updateStarted":
      if (state.work !== "idle") return state;
      return { ...state, work: "updating", lastUpdateAt: event.at };
    case "updateSucceeded":
      if (state.work !== "updating") return state;
      return { ...state, work: "idle", failedKey: null };
    case "updateFailed":
      if (state.work !== "updating") return state;
      return { ...state, work: "idle", failedKey: event.key };

    case "unshareStarted":
      if (state.work !== "idle") return state;
      return { ...state, work: "unsharing" };
    case "unshareFinished":
      if (state.work !== "unsharing") return state;
      return { ...state, work: "idle" };

    case "copied":
      return state.copied === event.ok ? state : { ...state, copied: event.ok };

    case "checked":
      return checkLink(state, event).state;
  }
}

/** What the popover's status line says about a shared link. */
export type LinkStatus = "updating" | "notUpdated" | "pending" | "upToDate";

export function linkStatus(state: ShareLinkState): LinkStatus {
  if (state.work === "updating") return "updating";
  if (state.stale && state.failedKey !== null) return "notUpdated";
  if (state.stale) return "pending";
  return "upToDate";
}
