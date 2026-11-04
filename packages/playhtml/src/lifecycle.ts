// ABOUTME: The playhtml instance lifecycle as one explicit state machine.
// ABOUTME: Init, first connection, room switches, delegation and failure are phases; flags are derived.

/**
 * Where this playhtml instance is in its life. Every readiness question the
 * rest of the library asks (has init started, is config locked, has the room
 * synced, can navigation run, is it loading) is derived from this one value,
 * so they cannot disagree.
 *
 * - idle: nothing has called init().
 * - starting: init() was called; config can still be declared.
 * - connecting: the first room is connecting. Config is locked. `synced` turns
 *   true when the room's data arrives, before elements are set up.
 * - ready: elements are set up against a synced room.
 * - switching: a room change or a server room reset is reconnecting after the
 *   first setup. Like connecting, but navigation keeps working.
 * - delegated: another playhtml instance on the page owns the connection, and
 *   this one only mirrors its readiness.
 * - failed: init could not connect.
 */
export type Lifecycle =
  | { phase: "idle" }
  | { phase: "starting" }
  | { phase: "connecting"; room: string; synced: boolean }
  | { phase: "ready"; room: string }
  | { phase: "switching"; room: string; synced: boolean }
  | { phase: "delegated"; settled: boolean }
  | { phase: "failed"; error: unknown };

export type LifecycleEvent =
  | { type: "initCalled" }
  | { type: "delegate" }
  | { type: "delegateSettled" }
  | { type: "connect"; room: string }
  | { type: "providerSynced" }
  | { type: "elementsReady" }
  | { type: "switchRoom"; room: string }
  | { type: "fail"; error: unknown }
  | { type: "reset" };

export const INITIAL_LIFECYCLE: Lifecycle = { phase: "idle" };

/**
 * The next lifecycle for an event. An event that does not apply to the
 * current phase leaves it unchanged, so stray or late events (a sync from a
 * provider torn down mid-switch, a navigation before the first setup) are
 * harmless.
 */
export function nextLifecycle(
  current: Lifecycle,
  event: LifecycleEvent,
): Lifecycle {
  switch (event.type) {
    case "reset":
      return INITIAL_LIFECYCLE;
    case "initCalled":
      return current.phase === "idle" ? { phase: "starting" } : current;
    case "delegate":
      return current.phase === "idle"
        ? { phase: "delegated", settled: false }
        : current;
    case "delegateSettled":
      return current.phase === "delegated"
        ? { phase: "delegated", settled: true }
        : current;
    case "connect":
      return current.phase === "starting"
        ? { phase: "connecting", room: event.room, synced: false }
        : current;
    case "providerSynced":
      return current.phase === "connecting" || current.phase === "switching"
        ? { ...current, synced: true }
        : current;
    case "elementsReady":
      return (current.phase === "connecting" ||
        current.phase === "switching") &&
        current.synced
        ? { phase: "ready", room: current.room }
        : current;
    case "switchRoom":
      // A server room reset can land while the first room is still connecting;
      // it rebuilds the connection, so the room has to sync again.
      if (current.phase === "connecting") {
        return { phase: "connecting", room: event.room, synced: false };
      }
      return current.phase === "ready" || current.phase === "switching"
        ? { phase: "switching", room: event.room, synced: false }
        : current;
    case "fail":
      return current.phase === "idle"
        ? current
        : { phase: "failed", error: event.error };
  }
}

/** init() has been called, so a later init() only waits for readiness. */
export function hasInitStarted(lifecycle: Lifecycle): boolean {
  return lifecycle.phase !== "idle";
}

/** Bootstrap has read config; a later configure() warns instead of applying. */
export function isConfigLocked(lifecycle: Lifecycle): boolean {
  return (
    lifecycle.phase === "connecting" ||
    lifecycle.phase === "ready" ||
    lifecycle.phase === "switching" ||
    lifecycle.phase === "failed"
  );
}

/** The current room's data has arrived, so elements can be set up against it. */
export function hasRoomSynced(lifecycle: Lifecycle): boolean {
  if (lifecycle.phase === "ready") return true;
  if (lifecycle.phase === "connecting" || lifecycle.phase === "switching") {
    return lifecycle.synced;
  }
  return false;
}

/**
 * Navigation can re-derive the room. Before the first setup finishes there is
 * nothing to navigate from, and a delegated instance leaves navigation to the
 * instance that owns the connection.
 */
export function canNavigate(lifecycle: Lifecycle): boolean {
  return lifecycle.phase === "ready" || lifecycle.phase === "switching";
}

/** Elements are not yet live against the current room. */
export function isLifecycleLoading(lifecycle: Lifecycle): boolean {
  if (lifecycle.phase === "ready") return false;
  if (lifecycle.phase === "delegated") return !lifecycle.settled;
  return true;
}
