// ABOUTME: Tests that createPresenceAPI correctly collapses multiple awareness
// ABOUTME: entries for the same user (multi-tab) into one deterministic view.

import { describe, it, expect } from "vitest";
import { createPresenceAPI } from "../presence";
import type { PlayerIdentity } from "@playhtml/common";

const CURSOR_FIELD = "__playhtml_cursors__";
const PRESENCE_FIELD = "__presence__";

interface MockAwareness {
  clientID: number;
  states: Map<number, Record<string, unknown>>;
  getStates(): Map<number, Record<string, unknown>>;
  getLocalState(): Record<string, unknown> | null;
  setLocalStateField(field: string, value: unknown): void;
  on(event: string, cb: (...args: unknown[]) => void): void;
}

function makeAwareness(clientID: number): MockAwareness {
  const states = new Map<number, Record<string, unknown>>();
  states.set(clientID, {});
  return {
    clientID,
    states,
    getStates: () => states,
    getLocalState: () => states.get(clientID) ?? null,
    setLocalStateField(field, value) {
      const cur = states.get(clientID) ?? {};
      states.set(clientID, { ...cur, [field]: value });
    },
    on() {},
  };
}

function makeIdentity(publicKey: string): PlayerIdentity {
  return {
    publicKey,
    playerStyle: { colorPalette: ["#000"] },
  } as PlayerIdentity;
}

function withCursor(identity: PlayerIdentity, presence?: Record<string, unknown>) {
  const state: Record<string, unknown> = {
    [CURSOR_FIELD]: { playerIdentity: identity, cursor: null },
  };
  if (presence) state[PRESENCE_FIELD] = presence;
  return state;
}

describe("createPresenceAPI multi-tab aggregation", () => {
  it("collapses two of my tabs into one entry that reflects my local tab's state", () => {
    // Local tab broadcast active=true; my other tab broadcast active=false.
    // Reading from the local tab, my entry should show active=true.
    const awareness = makeAwareness(1);
    const identity = makeIdentity("pk_me");
    awareness.states.set(1, withCursor(identity, { active: true }));
    awareness.states.set(2, withCursor(identity, { active: false }));

    const api = createPresenceAPI({
      getAwareness: () => awareness,
      getPlayerIdentity: () => identity,
    });

    const presences = api.getPresences();
    expect(presences.size).toBe(1);
    const me = presences.get("pk_me")!;
    expect(me.isMe).toBe(true);
    expect((me as any).active).toBe(true);
  });

  it("self entry is deterministic regardless of which clientID iterates last", () => {
    // Reverse insertion order: remote tab inserted before local. The previous
    // implementation overwrote self with the later-iterated entry — fixed now.
    const awareness = makeAwareness(1);
    const identity = makeIdentity("pk_me");
    awareness.states.set(2, withCursor(identity, { active: false }));
    awareness.states.set(1, withCursor(identity, { active: true }));

    const api = createPresenceAPI({
      getAwareness: () => awareness,
      getPlayerIdentity: () => identity,
    });

    const me = api.getPresences().get("pk_me")!;
    expect(me.isMe).toBe(true);
    expect((me as any).active).toBe(true);
  });

  it("collapses two tabs of a remote peer deterministically (highest clientID wins)", () => {
    // Remote peer "pk_remote" has two tabs. We pick the highest clientID so
    // results are stable across calls, independent of Map iteration order.
    const awareness = makeAwareness(1);
    const localIdentity = makeIdentity("pk_me");
    const remoteIdentity = makeIdentity("pk_remote");
    awareness.states.set(5, withCursor(remoteIdentity, { page: "/old" }));
    awareness.states.set(7, withCursor(remoteIdentity, { page: "/new" }));

    const api = createPresenceAPI({
      getAwareness: () => awareness,
      getPlayerIdentity: () => localIdentity,
    });

    const remote = api.getPresences().get("pk_remote")!;
    expect(remote.isMe).toBe(false);
    expect((remote as any).page).toBe("/new");

    // Insertion order swapped — result must be identical.
    awareness.states.clear();
    awareness.states.set(1, {});
    awareness.states.set(7, withCursor(remoteIdentity, { page: "/new" }));
    awareness.states.set(5, withCursor(remoteIdentity, { page: "/old" }));
    const remoteAgain = api.getPresences().get("pk_remote")!;
    expect((remoteAgain as any).page).toBe("/new");
  });

  it("single-tab users are unaffected", () => {
    const awareness = makeAwareness(1);
    const localIdentity = makeIdentity("pk_me");
    awareness.states.set(1, withCursor(localIdentity, { active: true }));
    awareness.states.set(2, withCursor(makeIdentity("pk_other"), { active: false }));

    const api = createPresenceAPI({
      getAwareness: () => awareness,
      getPlayerIdentity: () => localIdentity,
    });

    const presences = api.getPresences();
    expect(presences.size).toBe(2);
    expect((presences.get("pk_me") as any).active).toBe(true);
    expect((presences.get("pk_other") as any).active).toBe(false);
  });
});
