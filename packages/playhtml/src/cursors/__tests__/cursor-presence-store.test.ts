// ABOUTME: Verifies cursor state derived from generic realtime presence channels.
// ABOUTME: Keeps cursor transport state testable without DOM rendering or sockets.

import { describe, expect, it } from "vitest";
import type { PlayerIdentity } from "@playhtml/common";
import { CursorPresenceStore } from "../cursor-presence-store";

const alice: PlayerIdentity = {
  publicKey: "pk_alice",
  playerStyle: { colorPalette: ["red"] },
};

const bob: PlayerIdentity = {
  publicKey: "pk_bob",
  playerStyle: { colorPalette: ["blue"] },
};

describe("CursorPresenceStore", () => {
  it("builds remote cursor presence from generic presence sync channels", () => {
    const store = new CursorPresenceStore();

    store.applySync({
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
    const store = new CursorPresenceStore();

    store.applySync({
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
    const store = new CursorPresenceStore();

    store.applySync({
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

  it("coalesces cursor changes to the latest received value", () => {
    const store = new CursorPresenceStore();
    store.applySync({
      "conn-1": {
        identity: bob,
        cursor: {
          cursor: { x: 1, y: 2, pointer: "mouse" },
          at: 100,
        },
      },
    });

    store.applyChanges({
      type: "presence-changes",
      updates: {
        "conn-1": {
          cursor: {
            cursor: { x: 10, y: 20, pointer: "mouse" },
            at: 116,
          },
        },
      },
      removes: {},
    });

    expect(store.getPresenceByStableId("pk_bob")?.cursor).toEqual({
      x: 10,
      y: 20,
      pointer: "mouse",
    });
    expect(store.getPresenceByStableId("pk_bob")?.lastSeen).toBe(116);
  });

  it("keeps the identity after the cursor channel is removed", () => {
    const store = new CursorPresenceStore();
    store.applySync({
      "conn-1": {
        identity: bob,
        cursor: {
          cursor: { x: 1, y: 2, pointer: "mouse" },
        },
      },
    });

    store.applyChanges({
      type: "presence-changes",
      updates: {},
      removes: {
        "conn-1": ["cursor"],
      },
    });

    expect(store.getPresenceByStableId("pk_bob")).toEqual({
      cursor: null,
      playerIdentity: bob,
      lastSeen: undefined,
      message: null,
      page: undefined,
      zone: null,
    });
  });
});
