// ABOUTME: Verifies cursor presence derived from the shared PeerStore's folded
// ABOUTME: channels — decode, per-player collapse, and stale-cursor expiry.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PlayerIdentity, PresenceSnapshot } from "@playhtml/common";
import { createFakePresenceTransport } from "../../__tests__/presence-test-utils";
import { CursorPresenceStore } from "../cursor-presence-store";

// Pin the clock near the small `at` values used below so PeerStore's staleness
// sweep (which reads Date.now()) treats them as fresh; the expiry test advances
// time explicitly.
const CLOCK_START = 1_000;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(CLOCK_START);
});

afterEach(() => {
  vi.useRealTimers();
});

const alice: PlayerIdentity = {
  publicKey: "pk_alice",
  playerStyle: { colorPalette: ["red"] },
};

const bob: PlayerIdentity = {
  publicKey: "pk_bob",
  playerStyle: { colorPalette: ["blue"] },
};

function makeIdentity(publicKey: string): PlayerIdentity {
  return {
    publicKey,
    playerStyle: { colorPalette: ["#000000"] },
  };
}

/** Build a cursor view over a PeerStore, plus helpers to feed sync/changes. */
function makeStore() {
  const transport = createFakePresenceTransport();
  const store = new CursorPresenceStore(transport.peers);
  return {
    store,
    applySync(peers: PresenceSnapshot) {
      transport.emit({ type: "presence-sync", peers });
    },
    applyChanges(
      updates: PresenceSnapshot,
      removes: Record<string, string[]> = {},
    ) {
      transport.emit({ type: "presence-changes", updates, removes });
    },
  };
}

describe("CursorPresenceStore", () => {
  it("builds remote cursor presence from generic presence sync channels", () => {
    const { store, applySync } = makeStore();

    applySync({
      "conn-1": {
        identity: alice,
        cursor: {
          cursor: { x: 12, y: 34, pointer: "mouse" },
          page: "/week/1",
          zone: null,
          at: 100,
        },
      },
    });

    expect(Array.from(store.getRemotePresences("pk_self"))).toEqual([
      [
        "pk_alice",
        {
          cursor: { x: 12, y: 34, pointer: "mouse" },
          playerIdentity: alice,
          lastSeen: 100,
          message: null,
          page: "/week/1",
          zone: null,
        },
      ],
    ]);
  });

  it("ignores presences for the local public key", () => {
    const { store, applySync } = makeStore();

    applySync({
      "conn-1": {
        identity: alice,
        cursor: {
          cursor: { x: 12, y: 34, pointer: "mouse" },
        },
      },
    });

    expect(store.getRemotePresences(alice.publicKey).size).toBe(0);
  });

  it("keeps identity-only peers visible before their first cursor frame", () => {
    const { store, applySync } = makeStore();

    applySync({
      "conn-1": {
        identity: alice,
        page: "/week/1",
      },
    });

    expect(Array.from(store.getRemotePresences("pk_self"))).toEqual([
      [
        "pk_alice",
        {
          cursor: null,
          playerIdentity: alice,
          lastSeen: undefined,
          message: null,
          page: "/week/1",
          zone: null,
        },
      ],
    ]);
  });

  it("prefers an active cursor over identity-only tabs for the same public key", () => {
    const { store, applySync } = makeStore();

    applySync({
      "conn-1": {
        identity: alice,
        cursor: {
          cursor: { x: 12, y: 34, pointer: "mouse" },
          page: "/week/1",
          zone: null,
          at: 100,
        },
      },
      "conn-2": {
        identity: alice,
        page: "/idle",
      },
    });

    expect(store.getRemotePresences("pk_self").get(alice.publicKey)).toEqual({
      cursor: { x: 12, y: 34, pointer: "mouse" },
      playerIdentity: alice,
      lastSeen: 100,
      message: null,
      page: "/week/1",
      zone: null,
    });
  });

  it("coalesces cursor changes to the latest received value", () => {
    const { store, applySync, applyChanges } = makeStore();
    applySync({
      "conn-1": {
        identity: bob,
        cursor: {
          cursor: { x: 1, y: 2, pointer: "mouse" },
          at: 100,
        },
      },
    });

    applyChanges({
      "conn-1": {
        cursor: {
          cursor: { x: 10, y: 20, pointer: "mouse" },
          at: 116,
        },
      },
    });

    expect(store.getPresenceByStableId("pk_bob")?.cursor).toEqual({
      x: 10,
      y: 20,
      pointer: "mouse",
    });
    expect(store.getPresenceByStableId("pk_bob")?.lastSeen).toBe(116);
  });

  it("keeps the identity after the cursor channel is removed", () => {
    const { store, applySync, applyChanges } = makeStore();
    applySync({
      "conn-1": {
        identity: bob,
        cursor: {
          cursor: { x: 1, y: 2, pointer: "mouse" },
        },
      },
    });

    applyChanges({}, { "conn-1": ["cursor"] });

    expect(store.getPresenceByStableId("pk_bob")).toEqual({
      cursor: null,
      playerIdentity: bob,
      lastSeen: undefined,
      message: null,
      page: undefined,
      zone: null,
    });
  });

  it("drops a stale cursor channel (PeerStore sweep) while keeping identity", () => {
    // Expiry now lives in PeerStore's shared staleness sweep, not this view.
    // A cursor frame older than the 30s window is swept; the identity-only
    // peer remains (same behavior the old removeExpiredCursors had).
    const now = Date.now();
    const { store, applySync } = makeStore();
    applySync({
      "conn-stale": {
        identity: makeIdentity("stale"),
        // 31s old -> past the 30s staleness window.
        cursor: {
          cursor: { x: 30, y: 40, pointer: "mouse" },
          page: "/",
          at: now - 31_000,
        },
      },
    });

    // PeerStore prunes the stale cursor channel on fold, so it's gone already.
    const presence = store.getRemotePresences("local").get("stale");
    expect(presence?.playerIdentity.publicKey).toBe("stale");
    expect(presence?.cursor).toBeNull();
  });

  it("keeps a fresh cursor until it ages out on the periodic sweep", () => {
    const now = Date.now();
    const { store, applySync } = makeStore();
    applySync({
      "conn-1": {
        identity: makeIdentity("pk_x"),
        cursor: { cursor: { x: 1, y: 2, pointer: "mouse" }, at: now },
      },
    });
    // Still fresh right after arrival.
    expect(store.getRemotePresences("local").get("pk_x")?.cursor).not.toBeNull();

    // Advance past the staleness window; the periodic sweep drops the cursor.
    vi.advanceTimersByTime(31_000);
    expect(store.getRemotePresences("local").get("pk_x")?.cursor ?? null).toBeNull();
  });
});
