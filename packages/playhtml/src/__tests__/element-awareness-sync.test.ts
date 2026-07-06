// ABOUTME: Verifies element awareness snapshots stay current as peers update.
// ABOUTME: Covers removal paths so ephemeral user state does not linger.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { playhtml, resetPlayHTML } from "../index";

function getCurrentProvider(): any {
  const providers = (globalThis as any).PLAYHTML_TEST_PROVIDERS as any[];
  const provider = providers?.[providers.length - 1];
  if (!provider) throw new Error("Expected test provider");
  return provider;
}

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

    const provider = getCurrentProvider();
    const states = provider.awareness.getStates();
    states.set(2, {
      __playhtml_identity__: { publicKey: "pk_remote" },
      "can-play": {
        "presence-card": { active: true },
      },
    });
    provider.emit("change", { added: [2], updated: [], removed: [] });

    expect(awarenessSnapshots.at(-1)).toEqual([{ active: true }]);
    expect(byStableIdSnapshots.at(-1)?.get("pk_remote")).toEqual({
      active: true,
    });

    states.delete(2);
    provider.emit("change", { added: [], updated: [], removed: [2] });

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

    const providers = (globalThis as any).PLAYHTML_TEST_PROVIDERS as any[];
    expect(providers.length).toBeGreaterThanOrEqual(2);
    const mainProvider = providers[0];
    const cursorProvider = providers[1];
    expect(mainProvider.roomname).toBe(playhtml.roomId);
    expect(cursorProvider.roomname).not.toBe(playhtml.roomId);

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

    expect(mainProvider.awareness.getLocalState()?.["can-play"]).toEqual({
      "room-scoped-presence": { active: true },
    });
    expect(cursorProvider.awareness.getLocalState()?.["can-play"]).toBeUndefined();
  });

  it("keeps existing local awareness when a handler is created", async () => {
    const provider = getCurrentProvider();
    provider.awareness.setLocalStateField("can-play", {
      "seeded-presence": { active: true },
    });

    const el = document.createElement("div");
    el.id = "seeded-presence";
    el.setAttribute("can-play", "");
    (el as any).defaultData = {};
    (el as any).myDefaultAwareness = { active: false };
    (el as any).updateElement = vi.fn();
    document.body.appendChild(el);
    await playhtml.setupPlayElementForTag(el, "can-play");

    const handler = playhtml
      .elementHandlers.get("can-play")!
      .get("seeded-presence")!;

    expect(handler.awareness).toEqual([{ active: true }]);
    expect(handler.getAwarenessEventHandlerData().myAwareness).toEqual({
      active: true,
    });
    expect(
      provider.awareness.getLocalState()?.["can-play"]?.["seeded-presence"],
    ).toEqual({ active: true });
  });
});
