// ABOUTME: Verifies element awareness snapshots stay current as peers update.
// ABOUTME: Covers removal paths so ephemeral user state does not linger.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { elementHandlers, playhtml, resetPlayHTML } from "../index";
import {
  flushPresencePublishes,
  getPresenceSocketForRoom,
  getPresenceSockets,
  sentChannelUpdates,
} from "./presence-test-utils";

describe("element awareness sync", () => {
  beforeEach(async () => {
    document.body.innerHTML = "";
    (globalThis as any).PLAYHTML_TEST_PROVIDERS = [];
    await resetPlayHTML();
    await playhtml.init({
      cursors: { enabled: false },
    });
  });

  afterEach(async () => {
    document.body.innerHTML = "";
    await resetPlayHTML();
    vi.unstubAllGlobals();
  });

  it("clears a handler's awareness when the last peer leaves that element", async () => {
    const awarenessSnapshots: unknown[][] = [];
    const byStableIdSnapshots: Array<Map<string, unknown>> = [];

    const el = document.createElement("div");
    el.id = "presence-card";
    el.setAttribute("can-play", "");
    (el as any).defaultData = {};
    (el as any).updateElement = vi.fn();
    (el as any).updateElementAwareness = ({
      awareness,
      awarenessByStableId,
    }: any) => {
      awarenessSnapshots.push(awareness);
      byStableIdSnapshots.push(awarenessByStableId);
    };
    document.body.appendChild(el);
    await playhtml.setupPlayElementForTag(el, "can-play");

    const socket = getPresenceSocketForRoom(playhtml.roomId);
    socket.receive({
      type: "presence-sync",
      peers: {
        "conn-remote": {
          identity: {
            publicKey: "pk_remote",
            playerStyle: { colorPalette: ["blue"] },
          },
          "element:can-play": { "presence-card": { active: true } },
        },
      },
    });

    expect(awarenessSnapshots.at(-1)).toEqual([{ active: true }]);
    expect(byStableIdSnapshots.at(-1)?.get("pk_remote")).toEqual({ active: true });

    socket.receive({
      type: "presence-changes",
      updates: {},
      removes: { "conn-remote": ["identity", "element:can-play"] },
    });

    expect(awarenessSnapshots.at(-1)).toEqual([]);
    expect(byStableIdSnapshots.at(-1)?.size).toBe(0);
  });

  it("publishes element awareness through the page room when cursors use another room", async () => {
    document.body.innerHTML = "";
    (globalThis as any).PLAYHTML_TEST_PROVIDERS = [];
    await resetPlayHTML();
    await playhtml.init({
      cursors: { enabled: true, room: "domain" },
    });

    const el = document.createElement("div");
    el.id = "room-scoped-presence";
    el.setAttribute("can-play", "");
    (el as any).defaultData = {};
    (el as any).updateElement = vi.fn();
    document.body.appendChild(el);
    await playhtml.setupPlayElementForTag(el, "can-play");

    const handler = elementHandlers.get("can-play")!
      .get("room-scoped-presence")!;
    handler.setMyAwareness({ active: true } as any);
    // Publishing is coalesced onto a microtask.
    await flushPresencePublishes();

    const pageSocket = getPresenceSocketForRoom(playhtml.roomId);
    const cursorSocket = getPresenceSockets().find(
      (socket) => socket.options.room !== playhtml.roomId && !socket.closed,
    )!;
    expect(cursorSocket).toBeDefined();
    expect(sentChannelUpdates(pageSocket, "element:shard:0").at(-1)).toMatchObject({
      v: 1,
      entries: [["can-play", "room-scoped-presence", { active: true }]],
    });
    expect(sentChannelUpdates(cursorSocket, "element:can-play")).toEqual([]);
    expect(sentChannelUpdates(cursorSocket, "element:shard:0")).toEqual([]);
  });

  it("does not mutate the previous awareness state object when updating", async () => {
    vi.stubGlobal("WebSocket", undefined);
    document.body.innerHTML = "";
    (globalThis as any).PLAYHTML_TEST_PROVIDERS = [];
    await resetPlayHTML();
    await playhtml.init({
      cursors: { enabled: false },
    });

    function getCurrentProvider(): any {
      const providers = (globalThis as any).PLAYHTML_TEST_PROVIDERS as any[];
      const provider = providers?.[providers.length - 1];
      if (!provider) throw new Error("Expected test provider");
      return provider;
    }

    const provider = getCurrentProvider();

    const el = document.createElement("div");
    el.id = "toggle-presence";
    el.setAttribute("can-play", "");
    (el as any).defaultData = {};
    (el as any).myDefaultAwareness = { hovering: false };
    (el as any).updateElement = vi.fn();
    (el as any).updateElementAwareness = vi.fn();
    document.body.appendChild(el);
    await playhtml.setupPlayElementForTag(el, "can-play");

    const handler = elementHandlers.get("can-play")!
      .get("toggle-presence")!;

    // The provider only broadcasts an awareness update when y-protocols'
    // setLocalState sees a change via deep equality against the PREVIOUS state.
    // If the update mutates the previous state object in place, that comparison
    // sees no change and the broadcast is dropped — peers never see the update.
    // Capture the sub-object the handler will read, then update, and assert the
    // captured snapshot was left untouched (i.e. a fresh object was written).
    const beforeSub = provider.awareness.getLocalState()?.["can-play"] as Record<
      string,
      unknown
    >;
    const beforeSnapshot = JSON.stringify(beforeSub);

    handler.setMyAwareness({ hovering: true } as any);

    expect(JSON.stringify(beforeSub)).toBe(beforeSnapshot);
    expect(
      provider.awareness.getLocalState()?.["can-play"]?.["toggle-presence"],
    ).toEqual({ hovering: true });
    expect(provider.awareness.getLocalState()?.["can-play"]).not.toBe(beforeSub);
  });

  it("invokes updateElementAwareness once per local setMyAwareness", async () => {
    const calls: unknown[] = [];

    const el = document.createElement("div");
    el.id = "single-fire-presence";
    el.setAttribute("can-play", "");
    (el as any).defaultData = {};
    (el as any).updateElement = vi.fn();
    (el as any).updateElementAwareness = (data: any) => {
      calls.push(data);
    };
    document.body.appendChild(el);
    await playhtml.setupPlayElementForTag(el, "can-play");

    const handler = elementHandlers.get("can-play")!
      .get("single-fire-presence")!;

    calls.length = 0;
    handler.setMyAwareness({ active: true } as any);

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ myAwareness: { active: true } });
  });

  it("preserves remote awareness during a targeted local update", async () => {
    const calls: any[] = [];
    const el = document.createElement("div");
    el.id = "mixed-presence";
    el.setAttribute("can-play", "");
    (el as any).defaultData = {};
    (el as any).updateElement = () => {};
    (el as any).updateElementAwareness = (data: any) => calls.push(data);
    document.body.appendChild(el);
    await playhtml.setupPlayElementForTag(el, "can-play");

    const socket = getPresenceSocketForRoom(playhtml.roomId);
    socket.receive({
      type: "presence-sync",
      peers: {
        "conn-remote": {
          identity: {
            publicKey: "pk_remote",
            playerStyle: { colorPalette: ["blue"] },
          },
          "element:shard:0": {
            v: 1,
            entries: [["can-play", "mixed-presence", { active: "remote" }]],
          },
        },
      },
    });
    calls.length = 0;

    elementHandlers.get("can-play")!.get("mixed-presence")!
      .setMyAwareness({ active: "local" } as any);

    expect(calls).toHaveLength(1);
    expect(calls[0].awarenessByStableId.get("pk_remote")).toEqual({
      active: "remote",
    });
    expect(calls[0].awarenessByStableId.get(playhtml.users.me.pid)).toEqual({
      active: "local",
    });
  });

  it("keeps existing local awareness when a handler is recreated", async () => {
    const el = document.createElement("div");
    el.id = "seeded-presence";
    el.setAttribute("can-play", "");
    (el as any).defaultData = {};
    (el as any).myDefaultAwareness = { active: false };
    (el as any).updateElement = vi.fn();
    (el as any).updateElementAwareness = vi.fn();
    document.body.appendChild(el);
    await playhtml.setupPlayElementForTag(el, "can-play");

    elementHandlers.get("can-play")!.get("seeded-presence")!
      .setMyAwareness({ active: true } as any);

    // Re-binding the same element (e.g. a framework remount) must seed the new
    // handler from the published local awareness, not myDefaultAwareness.
    await playhtml.setupPlayElementForTag(el, "can-play");
    const handler = elementHandlers.get("can-play")!.get("seeded-presence")!;
    expect(handler.awareness).toEqual([{ active: true }]);
    expect(handler.getAwarenessEventHandlerData().myAwareness).toEqual({
      active: true,
    });
  });

  it("coalesces many elements' init awareness into a bounded burst of updates", async () => {
    // 100 elements each seed awareness on setup — without coalescing this would
    // be O(N) full-shard resends and blow the server's per-second budget. Add
    // them all, then run one synchronous setup sweep (the real page-load path)
    // so every setMyAwareness fires in the same tick and coalesces.
    for (let i = 0; i < 100; i += 1) {
      const el = document.createElement("div");
      el.id = `burst-${i}`;
      el.setAttribute("can-play", "");
      (el as any).defaultData = {};
      (el as any).myDefaultAwareness = { i };
      (el as any).updateElement = vi.fn();
      (el as any).updateElementAwareness = vi.fn();
      document.body.appendChild(el);
    }
    playhtml.setupPlayElements();
    await flushPresencePublishes();

    const socket = getPresenceSocketForRoom(playhtml.roomId);
    const updates = sentChannelUpdates(socket, "element:shard:0");
    // Bounded well under the server's 45 interactive-updates/sec budget.
    expect(updates.length).toBeLessThan(45);
    // Final published state contains every element.
    const finalShard = JSON.stringify(updates.at(-1));
    expect(finalShard).toContain("burst-0");
    expect(finalShard).toContain("burst-99");
  });

  it("updates only the element whose local awareness changed", async () => {
    const updateCounts = new Map<string, number>();
    for (let i = 0; i < 100; i += 1) {
      const elementId = `targeted-${i}`;
      const el = document.createElement("div");
      el.id = elementId;
      el.setAttribute("can-play", "");
      (el as any).defaultData = {};
      (el as any).myDefaultAwareness = { active: false };
      (el as any).updateElement = () => {};
      (el as any).updateElementAwareness = () => {
        updateCounts.set(elementId, (updateCounts.get(elementId) ?? 0) + 1);
      };
      document.body.appendChild(el);
    }
    playhtml.setupPlayElements();
    await flushPresencePublishes();
    expect(updateCounts.size).toBe(100);
    expect(Array.from(updateCounts.values()).every((count) => count === 1)).toBe(
      true,
    );
    updateCounts.clear();

    playhtml
      .getHandle("targeted-50", "can-play")
      .setMyAwareness({ active: true });

    expect(updateCounts).toEqual(new Map([["targeted-50", 1]]));
  });
});
