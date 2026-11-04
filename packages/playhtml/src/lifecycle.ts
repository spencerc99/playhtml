// ABOUTME: The playhtml instance lifecycle as one explicit state machine.
// ABOUTME: Loading a room, being ready, delegation and failure are phases; flags are derived.

/**
 * Where this playhtml instance is in its life. Every readiness question the
 * rest of the library asks (has init started, is config locked, has the room
 * synced, is it loading) is derived from this one value, so they cannot
 * disagree.
 *
 * - idle: nothing has called init(), or resetPlayHTML() ran.
 * - loading: a room is connecting, either the first one or after a room
 *   change or server room reset. `synced` turns true when the room's data
 *   arrives, before elements are set up against it.
 * - ready: elements are set up against a synced room.
 * - delegated: another playhtml instance on the page owns the connection, and
 *   this one only mirrors its readiness.
 * - failed: init could not connect.
 */
export type Lifecycle =
  | { phase: "idle" }
  | { phase: "loading"; room: string; synced: boolean }
  | { phase: "ready"; room: string }
  | { phase: "delegated"; settled: boolean }
  | { phase: "failed"; error: unknown };

export type LifecycleEvent =
  | { type: "connect"; room: string }
  | { type: "providerSynced" }
  | { type: "elementsReady" }
  | { type: "delegate" }
  | { type: "delegateSettled" }
  | { type: "fail"; error: unknown }
  | { type: "reset" };

export const INITIAL_LIFECYCLE: Lifecycle = { phase: "idle" };

/**
 * The next lifecycle for an event. An event that does not apply to the
 * current phase leaves it unchanged, so stray or late events (a sync from a
 * provider torn down mid-switch, elements reporting ready before the room
 * synced) are harmless.
 */
export function nextLifecycle(
  current: Lifecycle,
  event: LifecycleEvent,
): Lifecycle {
  switch (event.type) {
    case "reset":
      return INITIAL_LIFECYCLE;
    case "connect":
      // The first connection, a room change, or a server reset rebuilding the
      // connection: each one has to sync again.
      return current.phase === "idle" ||
        current.phase === "loading" ||
        current.phase === "ready"
        ? { phase: "loading", room: event.room, synced: false }
        : current;
    case "providerSynced":
      return current.phase === "loading"
        ? { ...current, synced: true }
        : current;
    case "elementsReady":
      return current.phase === "loading" && current.synced
        ? { phase: "ready", room: current.room }
        : current;
    case "delegate":
      return current.phase === "idle"
        ? { phase: "delegated", settled: false }
        : current;
    case "delegateSettled":
      return current.phase === "delegated"
        ? { phase: "delegated", settled: true }
        : current;
    case "fail":
      return { phase: "failed", error: event.error };
  }
}

/** Bootstrap has read config; a later configure() warns instead of applying. */
export function isConfigLocked(lifecycle: Lifecycle): boolean {
  return lifecycle.phase !== "idle" && lifecycle.phase !== "delegated";
}

/** The current room's data has arrived, so elements can be set up against it. */
export function hasRoomSynced(lifecycle: Lifecycle): boolean {
  return (
    lifecycle.phase === "ready" ||
    (lifecycle.phase === "loading" && lifecycle.synced)
  );
}

/** Elements are not yet live against the current room. */
export function isLifecycleLoading(lifecycle: Lifecycle): boolean {
  if (lifecycle.phase === "ready") return false;
  if (lifecycle.phase === "delegated") return !lifecycle.settled;
  return true;
}
