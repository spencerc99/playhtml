// ABOUTME: Verifies the stable PresenceFacade delegates and re-attaches
// ABOUTME: subscriptions across inner-client swaps (room rebuilds).

import { describe, expect, it, vi } from "vitest";
import type { PlayerIdentity, PresenceView } from "@playhtml/common";
import { PresenceFacade } from "../presence-facade";

type SubCallback = (presences: Map<string, PresenceView>) => void;

function makeIdentity(publicKey: string): PlayerIdentity {
  return { publicKey, playerStyle: { colorPalette: ["#000"] } } as PlayerIdentity;
}

/** Fake inner PresenceAPI that records writes and lets tests emit to subscribers. */
function makeInner(label: string) {
  const subs = new Map<number, { channel: string; callback: SubCallback }>();
  let nextId = 0;
  const writes: Array<[string, unknown]> = [];
  const replayed: string[] = [];
  const inner = {
    label,
    writes,
    subs,
    replayed,
    setMyPresence: vi.fn((channel: string, data: unknown) => {
      writes.push([channel, data]);
    }),
    getPresences: vi.fn(() => new Map<string, PresenceView>()),
    onPresenceChange: vi.fn((channel: string, callback: SubCallback) => {
      const id = nextId++;
      subs.set(id, { channel, callback });
      // Emulate the real clients replaying the current snapshot on subscribe.
      replayed.push(channel);
      callback(new Map());
      return () => {
        subs.delete(id);
      };
    }),
    getMyIdentity: vi.fn(() => makeIdentity(`pk_${label}`)),
    emit(channel: string, presences: Map<string, PresenceView>) {
      for (const sub of subs.values()) {
        if (sub.channel === channel) sub.callback(presences);
      }
    },
  };
  return inner;
}

describe("PresenceFacade", () => {
  it("delegates writes/reads/identity to the current inner", () => {
    const inner = makeInner("a");
    const facade = new PresenceFacade(inner);
    facade.setMyPresence("status", { text: "hi" });
    expect(inner.writes).toEqual([["status", { text: "hi" }]]);
    expect(facade.getMyIdentity().publicKey).toBe("pk_a");
    facade.getPresences();
    expect(inner.getPresences).toHaveBeenCalled();
  });

  it("routes writes to the NEW inner after setInner (captured reference stays live)", () => {
    const innerA = makeInner("a");
    const innerB = makeInner("b");
    const facade = new PresenceFacade(innerA);
    // Capture the facade "before navigation".
    const captured = facade;
    facade.setInner(innerB);
    captured.setMyPresence("status", { text: "after-nav" });
    expect(innerA.writes).toEqual([]);
    expect(innerB.writes).toEqual([["status", { text: "after-nav" }]]);
  });

  it("re-attaches a pre-swap subscription to the new inner and replays its snapshot", () => {
    const innerA = makeInner("a");
    const innerB = makeInner("b");
    const facade = new PresenceFacade(innerA);
    const received: Array<Map<string, PresenceView>> = [];
    facade.onPresenceChange("status", (presences) => received.push(presences));
    // Initial replay from inner A.
    expect(received).toHaveLength(1);
    expect(innerA.subs.size).toBe(1);

    facade.setInner(innerB);
    // Old inner detached, new inner attached + replayed.
    expect(innerA.subs.size).toBe(0);
    expect(innerB.subs.size).toBe(1);
    expect(received).toHaveLength(2);

    // Updates from the new inner reach the pre-swap callback.
    const snapshot = new Map<string, PresenceView>([
      ["pk_x", { playerIdentity: makeIdentity("pk_x"), cursor: null, isMe: false }],
    ]);
    innerB.emit("status", snapshot);
    expect(received).toHaveLength(3);
    expect(received[2].get("pk_x")).toBeDefined();
  });

  it("unsubscribe returned before a swap still detaches after the swap", () => {
    const innerA = makeInner("a");
    const innerB = makeInner("b");
    const facade = new PresenceFacade(innerA);
    const received: unknown[] = [];
    const unsub = facade.onPresenceChange("status", (p) => received.push(p));

    facade.setInner(innerB);
    expect(innerB.subs.size).toBe(1);

    unsub();
    expect(innerB.subs.size).toBe(0);
    received.length = 0;
    innerB.emit("status", new Map());
    expect(received).toHaveLength(0);
  });

  it("setInner is a no-op when the inner is unchanged", () => {
    const inner = makeInner("a");
    const facade = new PresenceFacade(inner);
    facade.onPresenceChange("status", () => {});
    const subscribeCalls = inner.onPresenceChange.mock.calls.length;
    facade.setInner(inner);
    expect(inner.onPresenceChange.mock.calls.length).toBe(subscribeCalls);
  });
});
