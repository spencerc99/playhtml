// ABOUTME: Verifies the presence API: playhtml.page, element presence/everyone, handle subscriptions, rooms.
// ABOUTME: Covers merge semantics, key and selector subscriptions, ordering, and the 2.15 aliases.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { playhtml, resetPlayHTML } from "../index";
import { wrapPagePresenceValue } from "../presence-utils";
import {
  flushPresencePublishes,
  getPresenceSocketForRoom,
} from "./presence-test-utils";

function receiveRemote(
  peers: Record<string, Record<string, unknown>>,
  room = playhtml.roomId,
) {
  getPresenceSocketForRoom(room).receive({ type: "presence-sync", peers });
}

const mina = {
  publicKey: "pk_mina",
  name: "Mina",
  playerStyle: { colorPalette: ["blue"] },
};

describe("playhtml.page presence", () => {
  beforeEach(async () => {
    await resetPlayHTML();
    document.body.innerHTML = "";
    await playhtml.init({ cursors: { enabled: false } });
    await flushPresencePublishes();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await resetPlayHTML();
    document.body.innerHTML = "";
  });

  it("throws before init", async () => {
    await resetPlayHTML();
    expect(() => playhtml.page).toThrow(/not available before init/);
  });

  it("merges top-level keys into my presence and clears with null", () => {
    playhtml.page.setPresence({ status: "typing", mood: "happy" });
    playhtml.page.setPresence({ status: "idle" });
    const [me] = playhtml.page.getEveryone();
    expect(me.user.isMe).toBe(true);
    expect(me.presence).toEqual({ status: "idle", mood: "happy" });

    playhtml.page.setPresence({ mood: null });
    expect(playhtml.page.getEveryone()[0].presence).toEqual({ status: "idle" });
  });

  it("includes remote people with their presence, in users order", () => {
    playhtml.page.setPresence({ status: "here" });
    receiveRemote({
      remote: {
        identity: mina,
        "presence:status": wrapPagePresenceValue("away"),
      },
    });
    const everyone = playhtml.page.getEveryone();
    expect(everyone.map(({ user }) => user.pid)).toEqual(
      playhtml.users.getAll().map((user) => user.pid),
    );
    expect(everyone.find(({ user }) => user.pid === "pk_mina")).toEqual({
      user: { pid: "pk_mina", name: "Mina", color: "blue", isMe: false },
      presence: { status: "away" },
    });
  });

  it("narrows to one key", () => {
    playhtml.page.setPresence({ status: "typing", mood: "happy" });
    expect(playhtml.page.getEveryone("status")[0].presence).toBe("typing");
  });

  it("rejects non-objects and reserved keys", () => {
    expect(() => playhtml.page.setPresence("typing" as any)).toThrow(/takes an object/);
    expect(() => playhtml.page.setPresence({ cursor: 1 })).toThrow(/users.cursors/);
    expect(() => playhtml.page.setPresence({ isMe: true })).toThrow(/reserved/);
  });

  it("key subscriptions replay, then fire only when that key changes", () => {
    const callback = vi.fn();
    const unsubscribe = playhtml.page.onPresenceChange("status", callback);
    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback.mock.lastCall![0][0].presence).toBeUndefined();

    playhtml.page.setPresence({ status: "typing" });
    expect(callback).toHaveBeenCalledTimes(2);
    expect(callback.mock.lastCall![0][0].presence).toBe("typing");

    playhtml.page.setPresence({ mood: "happy" });
    expect(callback).toHaveBeenCalledTimes(2);

    unsubscribe();
    playhtml.page.setPresence({ status: "idle" });
    expect(callback).toHaveBeenCalledTimes(2);
  });

  it("selector subscriptions fire only when the selection changes", () => {
    playhtml.page.setPresence({ status: { text: "a", emoji: "x" } });
    const callback = vi.fn();
    playhtml.page.onPresenceChange(
      (presence) => (presence.status as { text: string } | undefined)?.text,
      callback,
    );
    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback.mock.lastCall![0][0].presence).toBe("a");

    playhtml.page.setPresence({ status: { text: "a", emoji: "y" } });
    expect(callback).toHaveBeenCalledTimes(1);

    playhtml.page.setPresence({ status: { text: "b", emoji: "y" } });
    expect(callback).toHaveBeenCalledTimes(2);
    expect(callback.mock.lastCall![0][0].presence).toBe("b");
  });

  it("whole-object subscriptions see remote changes", () => {
    const callback = vi.fn();
    playhtml.page.onPresenceChange(callback);
    receiveRemote({
      remote: { identity: mina, "presence:status": wrapPagePresenceValue("away") },
    });
    const everyone = callback.mock.lastCall![0];
    expect(everyone.find(({ user }: any) => user.pid === "pk_mina").presence).toEqual({
      status: "away",
    });
  });

  it("the old presence API sees values written through the new one", () => {
    playhtml.page.setPresence({ status: "typing" });
    const self = Array.from(playhtml.presence.getPresences().values()).find(
      (view) => view.isMe,
    )!;
    expect((self as any).status).toBe("typing");
  });

  it("warns once in development mode when writes exceed the rate budget", async () => {
    await resetPlayHTML();
    await playhtml.init({ cursors: { enabled: false }, developmentMode: true });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    for (let i = 0; i < 25; i++) playhtml.page.setPresence({ scroll: i });
    const rateWarnings = warn.mock.calls.filter(([message]) =>
      String(message).includes("more than 20 times per second"),
    );
    expect(rateWarnings).toHaveLength(1);
  });
});

describe("element presence", () => {
  beforeEach(async () => {
    await resetPlayHTML();
    document.body.innerHTML = "";
    await playhtml.init({ cursors: { enabled: false } });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await resetPlayHTML();
    document.body.innerHTML = "";
  });

  function registerReady() {
    const element = document.createElement("button");
    element.id = "ready-card";
    document.body.append(element);
    const update = vi.fn();
    const handle = playhtml.register(element, {
      presence: { ready: false },
      update,
    });
    return { handle, update, element };
  }

  it("exposes myPresence, everyone, and setPresence to update", async () => {
    const { update } = registerReady();
    await flushPresencePublishes();
    const ctx = update.mock.lastCall![0];
    expect(ctx.myPresence).toEqual({ ready: false });
    expect(ctx.everyone).toEqual([
      {
        user: expect.objectContaining({ pid: playhtml.users.me.pid, isMe: true }),
        presence: { ready: false },
      },
    ]);

    ctx.setPresence({ ready: true });
    const next = update.mock.lastCall![0];
    expect(next.myPresence).toEqual({ ready: true });
    expect(next.everyone[0].presence).toEqual({ ready: true });
    // 2.15 names stay as aliases.
    expect(next.live).toEqual({ ready: true });
    expect(next.users).toBe(next.everyone);
  });

  it("handle reads and subscriptions work, including before the element binds", async () => {
    const handle = playhtml.register("late-card", {
      presence: { ready: false },
      update: () => {},
    });
    expect(handle.getMyPresence()).toBeUndefined();
    expect(handle.getEveryone()).toEqual([]);

    const callback = vi.fn();
    const unsubscribe = handle.onPresenceChange(
      (presence: { ready: boolean }) => presence.ready,
      callback,
    );
    expect(callback).toHaveBeenLastCalledWith([]);

    const element = document.createElement("div");
    element.id = "late-card";
    document.body.append(element);
    playhtml.setupPlayElement(element);
    await flushPresencePublishes();

    expect(handle.getMyPresence()).toEqual({ ready: false });
    expect(callback.mock.lastCall![0][0].presence).toBe(false);
    const calls = callback.mock.calls.length;

    handle.setPresence({ ready: false });
    expect(callback).toHaveBeenCalledTimes(calls);
    handle.setPresence({ ready: true });
    expect(callback.mock.lastCall![0][0].presence).toBe(true);

    unsubscribe();
    handle.setPresence({ ready: false });
    expect(callback.mock.lastCall![0][0].presence).toBe(true);
  });

  it("rejects more than one presence default", () => {
    expect(() =>
      playhtml.register("two-defaults", {
        presence: {},
        live: {},
        update: () => {},
      } as any),
    ).toThrow(/defines `presence` and `live`/);
  });
});

describe("presence rooms", () => {
  beforeEach(async () => {
    await resetPlayHTML();
    document.body.innerHTML = "";
    await playhtml.init({ cursors: { enabled: false } });
  });

  afterEach(async () => {
    await resetPlayHTML();
    document.body.innerHTML = "";
  });

  it("share the page presence API", () => {
    const room = playhtml.createPresenceRoom("lobby-42");
    room.setPresence({ ready: true });
    expect(room.getEveryone()[0].presence).toEqual({ ready: true });
    expect(playhtml.page.getEveryone()[0].presence).toEqual({});
    room.destroy();
  });
});
