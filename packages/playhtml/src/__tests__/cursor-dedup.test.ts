// ABOUTME: Tests for cursor deduplication by publicKey
// ABOUTME: Verifies that same-user multi-tab scenarios collapse to one cursor

import { describe, it, expect } from "vitest";
import { getStableIdForAwareness } from "../awareness-utils";

// Helper: builds a minimal awareness state with cursor + playerIdentity
function makeAwarenessState(publicKey: string, x = 50, y = 50) {
  return {
    __playhtml_cursors__: {
      cursor: { x, y, pointer: "default" },
      playerIdentity: {
        publicKey,
        playerStyle: { colorPalette: ["#ff0000"] },
      },
    },
  } as Record<string, unknown>;
}

/**
 * Decides whether a cursor should be skipped (not rendered).
 * Extracted as a pure function for testability -- the same logic
 * lives in CursorClientAwareness.handleAwarenessChange.
 */
function shouldSkipCursor(
  clientId: number,
  myClientId: number,
  stableId: string,
  myPublicKey: string,
): boolean {
  if (clientId === myClientId) return true;
  if (stableId === myPublicKey) return true;
  return false;
}

/**
 * Decides whether a cursor element should be removed when a clientId
 * disconnects, given the current clientId-to-stableId mapping.
 * Only remove if no other active clientId maps to the same stableId.
 */
function shouldRemoveCursor(
  stableId: string,
  disconnectedClientId: number,
  clientIdToStableId: Map<number, string>,
): boolean {
  for (const [cid, sid] of clientIdToStableId) {
    if (sid === stableId && cid !== disconnectedClientId) return false;
  }
  return true;
}

describe("cursor deduplication", () => {
  describe("getStableIdForAwareness collapses same publicKey", () => {
    it("two clientIds with same publicKey resolve to same stableId", () => {
      const pk = "pk_abc123";
      const stateA = makeAwarenessState(pk);
      const stateB = makeAwarenessState(pk, 100, 200);

      const idA = getStableIdForAwareness(stateA, 100);
      const idB = getStableIdForAwareness(stateB, 200);

      expect(idA).toBe(pk);
      expect(idB).toBe(pk);
      expect(idA).toBe(idB);
    });

    it("two clientIds with different publicKeys resolve to different stableIds", () => {
      const stateA = makeAwarenessState("pk_alice");
      const stateB = makeAwarenessState("pk_bob");

      const idA = getStableIdForAwareness(stateA, 100);
      const idB = getStableIdForAwareness(stateB, 200);

      expect(idA).not.toBe(idB);
    });
  });

  describe("shouldSkipCursor", () => {
    it("skips own clientId", () => {
      expect(shouldSkipCursor(100, 100, "pk_me", "pk_me")).toBe(true);
    });

    it("skips different clientId with same publicKey (other tab)", () => {
      expect(shouldSkipCursor(200, 100, "pk_me", "pk_me")).toBe(true);
    });

    it("renders different clientId with different publicKey", () => {
      expect(shouldSkipCursor(200, 100, "pk_other", "pk_me")).toBe(false);
    });
  });

  describe("shouldRemoveCursor (multi-tab removal safety)", () => {
    it("removes cursor when no other clientId has the same stableId", () => {
      const map = new Map<number, string>([[300, "pk_bob"]]);
      // clientId 300 is disconnecting, and it's the only one for pk_bob
      expect(shouldRemoveCursor("pk_bob", 300, map)).toBe(true);
    });

    it("keeps cursor when another clientId still maps to the same stableId", () => {
      const map = new Map<number, string>([
        [300, "pk_bob"],
        [400, "pk_bob"], // second tab
      ]);
      // clientId 300 disconnects, but 400 is still there
      expect(shouldRemoveCursor("pk_bob", 300, map)).toBe(false);
    });

    it("removes cursor when remaining clientIds map to different stableIds", () => {
      const map = new Map<number, string>([
        [300, "pk_bob"],
        [400, "pk_alice"],
      ]);
      expect(shouldRemoveCursor("pk_bob", 300, map)).toBe(true);
    });
  });

  describe("multi-tab stableId collapsing", () => {
    it("second clientId with same stableId maps to same key", () => {
      const pk = "pk_remoteuser";
      const stableIdToLatestClientId = new Map<string, number>();

      const stableId1 = getStableIdForAwareness(makeAwarenessState(pk), 300);
      stableIdToLatestClientId.set(stableId1, 300);

      const stableId2 = getStableIdForAwareness(makeAwarenessState(pk, 80, 90), 400);
      stableIdToLatestClientId.set(stableId2, 400);

      expect(stableId1).toBe(stableId2);
      expect(stableIdToLatestClientId.get(pk)).toBe(400);
    });
  });
});
