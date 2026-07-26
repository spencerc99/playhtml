// ABOUTME: Verifies cursor presence derived from the shared PeerStore's folded
// ABOUTME: channels — decode, per-player collapse, and stale-cursor expiry.

import { describe, expect, it } from "vitest";
import type {
  PlayerIdentity,
  PresenceServerMessage,
  PresenceSnapshot,
} from "@playhtml/common";
import { PeerStore } from "../../peer-store";
import { CursorPresenceStore } from "../cursor-presence-store";

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

/** A message source (transport stand-in) driven directly in tests. */
function makeSource() {
  const listeners = new Set<(message: PresenceServerMessage) => void>();
  return {
    subscribe(listener: (message: PresenceServerMessage) => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    emit(message: PresenceServerMessage) {
      for (const listener of listeners) listener(message);
    },
  };
}

/** Build a cursor view over a PeerStore, plus helpers to feed sync/changes. */
function makeStore() {
  const source = makeSource();
  const peerStore = new PeerStore(source);
  const store = new CursorPresenceStore(peerStore);
  return {
    store,
    applySync(peers: PresenceSnapshot) {
      source.emit({ type: "presence-sync", peers });
    },
    applyChanges(
      updates: PresenceSnapshot,
      removes: Record<string, string[]> = {},
    ) {
      source.emit({ type: "presence-changes", updates, removes });
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

  it("removes expired cursor channels while keeping identity presence", () => {
    const { store, applySync } = makeStore();
    applySync({
      "conn-stale": {
        identity: makeIdentity("stale"),
        cursor: {
          cursor: { x: 30, y: 40, pointer: "mouse" },
          page: "/",
          at: 1,
        },
      },
    });

    expect(store.removeExpiredCursors(1000, 500)).toBe(true);

    const presence = store.getRemotePresences("local").get("stale");
    expect(presence?.playerIdentity.publicKey).toBe("stale");
    expect(presence?.cursor).toBeNull();
  });
});
