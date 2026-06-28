// ABOUTME: Tests that createPresenceAPI populates playerIdentity for remote peers
// ABOUTME: in rooms where no cursor client is running (regression for non-cursor rooms).

import { describe, it, expect } from "vitest";
import { createPresenceAPI } from "../presence";
import type { PlayerIdentity } from "@playhtml/common";

const IDENTITY_FIELD = "__playhtml_identity__";

interface MockAwareness {
  clientID: number;
  states: Map<number, Record<string, unknown>>;
  listeners: Set<(...args: unknown[]) => void>;
  getStates(): Map<number, Record<string, unknown>>;
  getLocalState(): Record<string, unknown> | null;
  setLocalStateField(field: string, value: unknown): void;
  on(event: string, cb: (...args: unknown[]) => void): void;
  emitChange(): void;
}

function makeAwareness(clientID: number): MockAwareness {
  const states = new Map<number, Record<string, unknown>>();
  const listeners = new Set<(...args: unknown[]) => void>();
  states.set(clientID, {});
  return {
    clientID,
    states,
    listeners,
    getStates: () => states,
    getLocalState: () => states.get(clientID) ?? null,
    setLocalStateField(field, value) {
      const cur = states.get(clientID) ?? {};
      states.set(clientID, { ...cur, [field]: value });
    },
    on(event, cb) {
      if (event === "change") listeners.add(cb);
    },
    emitChange() {
      for (const listener of listeners) listener();
    },
  };
}

function makeIdentity(publicKey: string): PlayerIdentity {
  return {
    publicKey,
    playerStyle: { colorPalette: ["#000"] },
  } as PlayerIdentity;
}

describe("createPresenceAPI identity propagation", () => {
  it("writes local identity into __playhtml_identity__ on first use", () => {
    const awareness = makeAwareness(1);
    const identity = makeIdentity("pk_local");
    const api = createPresenceAPI({
      getAwareness: () => awareness,
      getPlayerIdentity: () => identity,
    });

    // Identity not written yet (lazy)
    expect(awareness.getLocalState()?.[IDENTITY_FIELD]).toBeUndefined();

    api.getPresences();
    expect(awareness.getLocalState()?.[IDENTITY_FIELD]).toEqual(identity);
  });

  it("resolves remote peer playerIdentity from __playhtml_identity__ when no cursor field", () => {
    const awareness = makeAwareness(1);
    const localIdentity = makeIdentity("pk_local");

    // Simulate a remote peer in a non-cursor room: they wrote IDENTITY_FIELD
    // but never wrote __playhtml_cursors__.
    const remoteIdentity = makeIdentity("pk_remote");
    awareness.states.set(2, { [IDENTITY_FIELD]: remoteIdentity });

    const api = createPresenceAPI({
      getAwareness: () => awareness,
      getPlayerIdentity: () => localIdentity,
    });

    const presences = api.getPresences();
    const remote = Array.from(presences.values()).find((p) => !p.isMe);
    expect(remote).toBeDefined();
    expect(remote!.playerIdentity).toEqual(remoteIdentity);
  });

  it("prefers cursor-field identity over __playhtml_identity__ for backwards compat", () => {
    const awareness = makeAwareness(1);
    const localIdentity = makeIdentity("pk_local");

    const cursorIdentity = makeIdentity("pk_from_cursor");
    const fallbackIdentity = makeIdentity("pk_from_fallback");
    awareness.states.set(2, {
      __playhtml_cursors__: { playerIdentity: cursorIdentity },
      [IDENTITY_FIELD]: fallbackIdentity,
    });

    const api = createPresenceAPI({
      getAwareness: () => awareness,
      getPlayerIdentity: () => localIdentity,
    });

    const presences = api.getPresences();
    const remote = Array.from(presences.values()).find((p) => !p.isMe);
    expect(remote!.playerIdentity).toEqual(cursorIdentity);
  });

  it("identity write is idempotent across multiple API calls", () => {
    const awareness = makeAwareness(1);
    const identity = makeIdentity("pk_local");
    let calls = 0;
    const wrappedAwareness = {
      ...awareness,
      setLocalStateField(field: string, value: unknown) {
        if (field === IDENTITY_FIELD) calls++;
        awareness.setLocalStateField(field, value);
      },
    };

    const api = createPresenceAPI({
      getAwareness: () => wrappedAwareness,
      getPlayerIdentity: () => identity,
    });

    api.getPresences();
    api.setMyPresence("page", { url: "/" });
    api.getPresences();
    expect(calls).toBe(1);
  });

  it("re-arms the identity write after the awareness provider is rebuilt", () => {
    // Regression: SPA navigation rebuilds the cursor/main provider, which
    // creates a fresh awareness object with no identity field. The presence
    // API must write identity into the new awareness on next use.
    let awareness = makeAwareness(1);
    const identity = makeIdentity("pk_local");

    const api = createPresenceAPI({
      getAwareness: () => awareness,
      getPlayerIdentity: () => identity,
    });

    api.getPresences();
    expect(awareness.getLocalState()?.[IDENTITY_FIELD]).toEqual(identity);

    // Simulate provider rebind on navigation: brand-new awareness instance.
    awareness = makeAwareness(2);
    expect(awareness.getLocalState()?.[IDENTITY_FIELD]).toBeUndefined();

    api.getPresences();
    expect(awareness.getLocalState()?.[IDENTITY_FIELD]).toEqual(identity);
  });

  it("re-attaches channel listeners after the awareness provider is rebuilt", () => {
    let awareness = makeAwareness(1);
    const identity = makeIdentity("pk_local");
    const remoteIdentity = makeIdentity("pk_remote");
    const api = createPresenceAPI({
      getAwareness: () => awareness,
      getPlayerIdentity: () => identity,
    });
    const received: Array<Map<string, unknown>> = [];
    const unsub = api.onPresenceChange("status", (presences) => {
      received.push(presences as Map<string, unknown>);
    });
    received.length = 0;

    awareness = makeAwareness(2);
    api.getPresences();
    awareness.states.set(3, {
      [IDENTITY_FIELD]: remoteIdentity,
      __presence__: { status: { text: "available" } },
    });
    awareness.emitChange();

    expect(received).toHaveLength(1);
    const remote = Array.from(received[0].values()).find((p: any) => !p.isMe) as any;
    expect(remote.status).toEqual({ text: "available" });
    unsub();
  });

  it("returns playerIdentity undefined for peers with no identity at all", () => {
    // Pin the contract: missing both cursor field and identity field should
    // not throw; playerIdentity is simply undefined on the view.
    const awareness = makeAwareness(1);
    awareness.states.set(2, { __presence__: { tab: { id: "x" } } });

    const api = createPresenceAPI({
      getAwareness: () => awareness,
      getPlayerIdentity: () => makeIdentity("pk_local"),
    });

    const presences = api.getPresences();
    const remote = Array.from(presences.values()).find((p) => !p.isMe);
    expect(remote).toBeDefined();
    expect(remote!.playerIdentity).toBeUndefined();
  });
});
