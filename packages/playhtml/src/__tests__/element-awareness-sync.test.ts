// ABOUTME: Verifies element awareness snapshots stay current as peers update.
// ABOUTME: Covers removal paths so ephemeral user state does not linger.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { playhtml, resetPlayHTML } from "../index";
import {
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

    const handler = playhtml
      .elementHandlers.get("can-play")!
      .get("room-scoped-presence")!;
    handler.setMyAwareness({ active: true } as any);

    const pageSocket = getPresenceSocketForRoom(playhtml.roomId);
    const cursorSocket = getPresenceSockets().find(
      (socket) => socket.options.room !== playhtml.roomId && !socket.closed,
    )!;
    expect(cursorSocket).toBeDefined();
    expect(sentChannelUpdates(pageSocket, "element:can-play").at(-1)).toEqual({
      "room-scoped-presence": { active: true },
    });
    expect(sentChannelUpdates(cursorSocket, "element:can-play")).toEqual([]);
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
    document.body.appendChild(el);
    await playhtml.setupPlayElementForTag(el, "can-play");

    const handler = playhtml
      .elementHandlers.get("can-play")!
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

    const handler = playhtml
      .elementHandlers.get("can-play")!
      .get("single-fire-presence")!;

    calls.length = 0;
    handler.setMyAwareness({ active: true } as any);

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ myAwareness: { active: true } });
  });

  it("keeps existing local awareness when a handler is recreated", async () => {
    const el = document.createElement("div");
    el.id = "seeded-presence";
    el.setAttribute("can-play", "");
    (el as any).defaultData = {};
    (el as any).myDefaultAwareness = { active: false };
    (el as any).updateElement = vi.fn();
    document.body.appendChild(el);
    await playhtml.setupPlayElementForTag(el, "can-play");

    playhtml.elementHandlers.get("can-play")!.get("seeded-presence")!
      .setMyAwareness({ active: true } as any);

    // Re-binding the same element (e.g. a framework remount) must seed the new
    // handler from the published local awareness, not myDefaultAwareness.
    await playhtml.setupPlayElementForTag(el, "can-play");
    const handler = playhtml.elementHandlers.get("can-play")!.get("seeded-presence")!;
    expect(handler.awareness).toEqual([{ active: true }]);
    expect(handler.getAwarenessEventHandlerData().myAwareness).toEqual({
      active: true,
    });
  });
});
