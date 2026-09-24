// ABOUTME: Verifies the shared PeerStore folds channels once and notifies only
// ABOUTME: the namespaces a message touched, replaying snapshots to subscribers.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PresenceServerMessage } from "@playhtml/common";
import { PEER_SYNC_GRACE_MS, PeerStore } from "../peer-store";

// Pin the clock so the tiny `at` timestamps used as fold fixtures below stay
// within PeerStore's staleness window (the staleness sweep is exercised by its
// own dedicated test with an explicit time advance).
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(100);
});

afterEach(() => {
  vi.useRealTimers();
});

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

const identity = (publicKey: string) => ({
  publicKey,
  playerStyle: { colorPalette: ["#000"] },
});

describe("PeerStore", () => {
  it("folds a presence-sync snapshot into the peer map", () => {
    const source = makeSource();
    const store = new PeerStore(source);
    source.emit({
      type: "presence-sync",
      peers: {
        "conn-1": { identity: identity("pk_a"), "presence:status": { t: 1 } },
      },
    });
    expect(store.getPeers().get("conn-1")).toEqual({
      identity: identity("pk_a"),
      "presence:status": { t: 1 },
    });
  });

  it("merges presence-changes updates and deletes removed channels", () => {
    const source = makeSource();
    const store = new PeerStore(source);
    source.emit({
      type: "presence-sync",
      peers: { "conn-1": { identity: identity("pk_a"), cursor: { at: 1 } } },
    });
    source.emit({
      type: "presence-changes",
      updates: { "conn-1": { cursor: { at: 2 } } },
      removes: {},
    });
    expect(store.getPeers().get("conn-1")!.cursor).toEqual({ at: 2 });

    source.emit({
      type: "presence-changes",
      updates: {},
      removes: { "conn-1": ["cursor"] },
    });
    expect("cursor" in store.getPeers().get("conn-1")!).toBe(false);
    // identity remains, so the peer row survives.
    expect(store.getPeers().has("conn-1")).toBe(true);
  });

  it("prunes a peer row when its last channel is removed", () => {
    const source = makeSource();
    const store = new PeerStore(source);
    source.emit({
      type: "presence-sync",
      peers: { "conn-1": { cursor: { at: 1 } } },
    });
    source.emit({
      type: "presence-changes",
      updates: {},
      removes: { "conn-1": ["cursor"] },
    });
    expect(store.getPeers().has("conn-1")).toBe(false);
  });

  it("replays the current snapshot immediately to a late subscriber", () => {
    const source = makeSource();
    const store = new PeerStore(source);
    source.emit({
      type: "presence-sync",
      peers: { "conn-1": { "presence:x": 1 } },
    });
    const cb = vi.fn();
    store.subscribe("presence", cb);
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("notifies only the namespaces a changes message touched", () => {
    const source = makeSource();
    const store = new PeerStore(source);
    const cursorCb = vi.fn();
    const elementCb = vi.fn();
    const presenceCb = vi.fn();
    const identityCb = vi.fn();
    store.subscribe("cursor", cursorCb);
    store.subscribe("element", elementCb);
    store.subscribe("presence", presenceCb);
    store.subscribe("identity", identityCb);
    // Clear the initial replay calls.
    cursorCb.mockClear();
    elementCb.mockClear();
    presenceCb.mockClear();
    identityCb.mockClear();

    // A cursor-only update must fire ONLY the cursor subscriber.
    source.emit({
      type: "presence-changes",
      updates: { "conn-1": { cursor: { at: 1 } } },
      removes: {},
    });
    expect(cursorCb).toHaveBeenCalledTimes(1);
    expect(elementCb).not.toHaveBeenCalled();
    expect(presenceCb).not.toHaveBeenCalled();
    expect(identityCb).not.toHaveBeenCalled();

    // An element-only update fires only the element subscriber.
    source.emit({
      type: "presence-changes",
      updates: { "conn-1": { "element:shard:0": { v: 1, entries: [] } } },
      removes: {},
    });
    expect(elementCb).toHaveBeenCalledTimes(1);
    expect(cursorCb).toHaveBeenCalledTimes(1); // unchanged
    expect(presenceCb).not.toHaveBeenCalled();

    // A presence-only update fires only the presence subscriber.
    source.emit({
      type: "presence-changes",
      updates: { "conn-1": { "presence:status": { t: 1 } } },
      removes: {},
    });
    expect(presenceCb).toHaveBeenCalledTimes(1);
    expect(cursorCb).toHaveBeenCalledTimes(1);
    expect(elementCb).toHaveBeenCalledTimes(1);

    // An identity change fires only identity.
    source.emit({
      type: "presence-changes",
      updates: { "conn-1": { identity: identity("pk_new") } },
      removes: {},
    });
    expect(identityCb).toHaveBeenCalledTimes(1);
    expect(cursorCb).toHaveBeenCalledTimes(1);
  });

  it("fires a listener at most once per message across its subscribed namespaces", () => {
    const source = makeSource();
    const store = new PeerStore(source);
    const cb = vi.fn();
    // Same reference on two namespaces (mirrors the cursor/element/presence
    // views watching their own namespace + identity).
    store.subscribe("cursor", cb);
    store.subscribe("identity", cb);
    cb.mockClear();

    // A message touching BOTH cursor and identity must fire cb once, not twice.
    source.emit({
      type: "presence-changes",
      updates: { "conn-1": { cursor: { at: 1 }, identity: identity("pk_a") } },
      removes: {},
    });
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("classifies message and page channels as cursor namespace", () => {
    const source = makeSource();
    const store = new PeerStore(source);
    const cursorCb = vi.fn();
    const presenceCb = vi.fn();
    store.subscribe("cursor", cursorCb);
    store.subscribe("presence", presenceCb);
    cursorCb.mockClear();
    presenceCb.mockClear();

    source.emit({
      type: "presence-changes",
      updates: { "conn-1": { message: "hi", page: "/p" } },
      removes: {},
    });
    expect(cursorCb).toHaveBeenCalledTimes(1);
    expect(presenceCb).not.toHaveBeenCalled();
  });

  it("notifies all namespaces on a full sync snapshot", () => {
    const source = makeSource();
    const store = new PeerStore(source);
    const cbs = {
      cursor: vi.fn(),
      element: vi.fn(),
      presence: vi.fn(),
      identity: vi.fn(),
    };
    store.subscribe("cursor", cbs.cursor);
    store.subscribe("element", cbs.element);
    store.subscribe("presence", cbs.presence);
    store.subscribe("identity", cbs.identity);
    for (const cb of Object.values(cbs)) cb.mockClear();

    source.emit({ type: "presence-sync", peers: {} });
    for (const cb of Object.values(cbs)) {
      expect(cb).toHaveBeenCalledTimes(1);
    }
  });

  it("stops notifying after unsubscribe and destroy", () => {
    const source = makeSource();
    const store = new PeerStore(source);
    const cb = vi.fn();
    const unsub = store.subscribe("presence", cb);
    cb.mockClear();
    unsub();
    source.emit({
      type: "presence-changes",
      updates: { "conn-1": { "presence:x": 1 } },
      removes: {},
    });
    expect(cb).not.toHaveBeenCalled();

    // destroy detaches from the source: further emits do not fold.
    store.destroy();
    source.emit({
      type: "presence-sync",
      peers: { "conn-2": { "presence:y": 2 } },
    });
    expect(store.getPeers().has("conn-2")).toBe(false);
  });

  it("isolates a throwing subscriber so others in the same namespace still fire", () => {
    const source = makeSource();
    const store = new PeerStore(source);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const good = vi.fn();
    store.subscribe("presence", () => {
      throw new Error("boom");
    });
    store.subscribe("presence", good);
    good.mockClear();

    expect(() =>
      source.emit({
        type: "presence-changes",
        updates: { "conn-1": { "presence:x": 1 } },
        removes: {},
      }),
    ).not.toThrow();
    expect(good).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("sweeps a stale stamped channel on the periodic timer (ghost peer)", () => {
    const source = makeSource();
    const store = new PeerStore(source);
    const now = Date.now();
    source.emit({
      type: "presence-sync",
      peers: {
        "conn-ghost": {
          identity: identity("pk_ghost"),
          "presence:status": { at: now, value: { t: 1 } },
        },
      },
    });
    expect("presence:status" in store.getPeers().get("conn-ghost")!).toBe(true);

    // No further message arrives (killed tab). After the window, the periodic
    // sweep drops the stale channel; identity (unstamped) survives.
    vi.advanceTimersByTime(31_000);
    const ghost = store.getPeers().get("conn-ghost")!;
    expect("presence:status" in ghost).toBe(false);
    expect("identity" in ghost).toBe(true);
  });

  it("does not notify when a periodic sweep expires nothing", () => {
    const source = makeSource();
    const store = new PeerStore(source);
    source.emit({
      type: "presence-sync",
      peers: { "conn-1": { identity: identity("pk_a") } },
    });
    const cb = vi.fn();
    store.subscribe("presence", cb);
    cb.mockClear();
    // Advancing time with only an unstamped identity channel expires nothing.
    vi.advanceTimersByTime(31_000);
    expect(cb).not.toHaveBeenCalled();
  });

  describe("peers missing from a sync snapshot", () => {
    function syncTwoPeers(source: ReturnType<typeof makeSource>) {
      source.emit({
        type: "presence-sync",
        peers: {
          "conn-1": { identity: identity("pk_a") },
          "conn-2": { identity: identity("pk_b") },
        },
      });
    }

    it("keeps an absent peer through the grace window, then removes and notifies", () => {
      const source = makeSource();
      const store = new PeerStore(source);
      syncTwoPeers(source);
      const cb = vi.fn();
      store.subscribe("identity", cb);

      source.emit({
        type: "presence-sync",
        peers: { "conn-1": { identity: identity("pk_a") } },
      });
      expect(store.getPeers().has("conn-2")).toBe(true);
      cb.mockClear();

      vi.advanceTimersByTime(PEER_SYNC_GRACE_MS - 1);
      expect(store.getPeers().has("conn-2")).toBe(true);
      expect(cb).not.toHaveBeenCalled();

      vi.advanceTimersByTime(1);
      expect(store.getPeers().has("conn-2")).toBe(false);
      expect(store.getPeers().has("conn-1")).toBe(true);
      expect(cb).toHaveBeenCalledTimes(1);
    });

    it("cancels removal when a later sync includes the peer again", () => {
      const source = makeSource();
      const store = new PeerStore(source);
      syncTwoPeers(source);

      source.emit({ type: "presence-sync", peers: {} });
      source.emit({
        type: "presence-sync",
        peers: { "conn-2": { identity: identity("pk_b2") } },
      });
      vi.advanceTimersByTime(PEER_SYNC_GRACE_MS);

      expect(store.getPeers().has("conn-1")).toBe(false);
      expect(store.getPeers().get("conn-2")).toEqual({
        identity: identity("pk_b2"),
      });
    });

    it("cancels removal when an update arrives for the peer", () => {
      const source = makeSource();
      const store = new PeerStore(source);
      syncTwoPeers(source);

      source.emit({ type: "presence-sync", peers: {} });
      source.emit({
        type: "presence-changes",
        updates: { "conn-1": { "presence:status": { at: 100, t: 2 } } },
        removes: {},
      });
      vi.advanceTimersByTime(PEER_SYNC_GRACE_MS);

      expect(store.getPeers().has("conn-1")).toBe(true);
      expect(store.getPeers().has("conn-2")).toBe(false);
    });

    it("does not extend the grace window across repeated syncs", () => {
      const source = makeSource();
      const store = new PeerStore(source);
      syncTwoPeers(source);

      source.emit({ type: "presence-sync", peers: {} });
      vi.advanceTimersByTime(PEER_SYNC_GRACE_MS - 1_000);
      source.emit({ type: "presence-sync", peers: {} });
      vi.advanceTimersByTime(1_000);

      expect(store.getPeers().size).toBe(0);
    });

    it("clears the pending expiry on destroy", () => {
      const source = makeSource();
      const store = new PeerStore(source, { syncGraceMs: 2_000 });
      syncTwoPeers(source);
      const cb = vi.fn();
      store.subscribe("identity", cb);

      source.emit({ type: "presence-sync", peers: {} });
      expect(vi.getTimerCount()).toBe(2);
      cb.mockClear();
      store.destroy();

      expect(vi.getTimerCount()).toBe(0);
      vi.advanceTimersByTime(2_000);
      expect(cb).not.toHaveBeenCalled();
    });
  });
});
