// ABOUTME: Verifies the people API: playhtml.people, element everyone/me/setMyPresence, handle subscriptions, rooms.
// ABOUTME: Covers key-form writes, key subscriptions, ordering, cursors, and the 2.15 aliases.
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

describe("playhtml.people", () => {
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
    expect(() => playhtml.people).toThrow(/not available before init/);
  });

  it("sets one key at a time and clears with null", () => {
    playhtml.people.setMyPresence("status", "typing");
    playhtml.people.setMyPresence("mood", "happy");
    playhtml.people.setMyPresence("status", "idle");
    const [me] = playhtml.people.everyone;
    expect(me.isMe).toBe(true);
    expect(me.pid).toBe(playhtml.people.me.pid);
    expect(me.presence).toEqual({ status: "idle", mood: "happy" });
    expect(playhtml.people.me.presence).toEqual({ status: "idle", mood: "happy" });

    playhtml.people.setMyPresence("mood", null);
    expect(playhtml.people.everyone[0].presence).toEqual({ status: "idle" });
  });

  it("me has your identity, and name and color setters", () => {
    const { me } = playhtml.people;
    expect(me.isMe).toBe(true);
    expect(me.pid).toBe(playhtml.users.me.pid);
    me.name = "Ada";
    me.color = "red";
    expect(playhtml.users.me.name).toBe("Ada");
    expect(playhtml.people.everyone[0]).toMatchObject({ name: "Ada", color: "red" });
  });

  it("includes remote people with their presence, in join order", () => {
    playhtml.people.setMyPresence("status", "here");
    receiveRemote({
      remote: {
        identity: mina,
        "presence:status": wrapPagePresenceValue("away"),
      },
    });
    const { everyone } = playhtml.people;
    expect(everyone.map((person) => person.pid)).toEqual(
      playhtml.users.getAll().map((user) => user.pid),
    );
    expect(everyone.find((person) => person.pid === "pk_mina")).toEqual({
      pid: "pk_mina",
      name: "Mina",
      color: "blue",
      isMe: false,
      presence: { status: "away" },
    });
    expect(playhtml.people.getAll()).toEqual(everyone);
  });

  it("rejects bad calls and reserved keys", () => {
    expect(() => playhtml.people.setMyPresence({ status: 1 } as any, undefined)).toThrow(
      /takes a key and a value/,
    );
    expect(() => playhtml.people.setMyPresence("cursor", 1)).toThrow(/set by playhtml/);
    expect(() => playhtml.people.setMyPresence("isMe", true)).toThrow(/reserved/);
    expect(() => (playhtml.people.setMyPresence as any)("status")).toThrow(/needs a value/);
  });

  it("key subscriptions replay, then fire only when that key changes", () => {
    const callback = vi.fn();
    const unsubscribe = playhtml.people.onChange("status", callback);
    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback.mock.lastCall![0][0].presence.status).toBeUndefined();

    playhtml.people.setMyPresence("status", "typing");
    expect(callback).toHaveBeenCalledTimes(2);
    expect(callback.mock.lastCall![0][0].presence.status).toBe("typing");

    playhtml.people.setMyPresence("mood", "happy");
    expect(callback).toHaveBeenCalledTimes(2);

    unsubscribe();
    playhtml.people.setMyPresence("status", "idle");
    expect(callback).toHaveBeenCalledTimes(2);
  });

  it("watches a list of keys", () => {
    const callback = vi.fn();
    playhtml.people.onChange(["status", "mood"], callback);
    playhtml.people.setMyPresence("mood", "happy");
    expect(callback).toHaveBeenCalledTimes(2);
    playhtml.people.setMyPresence("other", 1);
    expect(callback).toHaveBeenCalledTimes(2);
  });

  it("key subscriptions fire when people join, rename, or leave", () => {
    const callback = vi.fn();
    playhtml.people.onChange("status", callback);
    expect(callback).toHaveBeenCalledTimes(1);

    receiveRemote({ remote: { identity: mina } });
    expect(callback).toHaveBeenCalledTimes(2);
    expect(callback.mock.lastCall![0].map((person: any) => person.pid)).toContain("pk_mina");

    receiveRemote({ remote: { identity: { ...mina, name: "Mina B" } } });
    expect(callback).toHaveBeenCalledTimes(3);

    getPresenceSocketForRoom(playhtml.roomId).receive({
      type: "presence-changes",
      updates: {},
      removes: { remote: ["identity"] },
    });
    expect(callback).toHaveBeenCalledTimes(4);
    expect(callback.mock.lastCall![0].map((person: any) => person.pid)).not.toContain("pk_mina");
  });

  it("whole-presence subscriptions see remote changes", () => {
    const callback = vi.fn();
    playhtml.people.onChange(callback);
    receiveRemote({
      remote: { identity: mina, "presence:status": wrapPagePresenceValue("away") },
    });
    const everyone = callback.mock.lastCall![0];
    expect(everyone.find((person: any) => person.pid === "pk_mina").presence).toEqual({
      status: "away",
    });
  });

  it("the old presence API sees values written through the new one", () => {
    playhtml.people.setMyPresence("status", "typing");
    const self = Array.from(playhtml.presence.getPresences().values()).find(
      (view) => view.isMe,
    )!;
    expect((self as any).status).toBe("typing");
  });

  it("warns once in development mode when writes exceed the rate budget", async () => {
    await resetPlayHTML();
    await playhtml.init({ cursors: { enabled: false }, developmentMode: true });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    for (let i = 0; i < 25; i++) playhtml.people.setMyPresence("scroll", i);
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
      defaultPresence: { ready: false, note: "" },
      update,
    });
    return { handle, update, element };
  }

  it("exposes everyone, me, and setMyPresence to update", async () => {
    const { update } = registerReady();
    await flushPresencePublishes();
    const ctx = update.mock.lastCall![0];
    expect(ctx.me).toMatchObject({
      pid: playhtml.people.me.pid,
      isMe: true,
      presence: { ready: false, note: "" },
    });
    expect(ctx.everyone).toEqual([
      expect.objectContaining({
        pid: playhtml.people.me.pid,
        isMe: true,
        presence: { ready: false, note: "" },
      }),
    ]);

    ctx.setMyPresence({ ready: true, note: "" });
    const next = update.mock.lastCall![0];
    expect(next.me.presence).toEqual({ ready: true, note: "" });
    expect(next.everyone[0].presence).toEqual({ ready: true, note: "" });
  });

  it("setMyPresence takes a mutator like setData", async () => {
    const { update, handle } = registerReady();
    await flushPresencePublishes();
    update.mock.lastCall![0].setMyPresence((draft: any) => {
      draft.note = "hi";
    });
    expect(handle.me.presence).toEqual({ ready: false, note: "hi" });
    handle.setMyPresence((draft: any) => ({ ...draft, ready: true }));
    expect(handle.me.presence).toEqual({ ready: true, note: "hi" });
  });

  it("keeps the 2.15 names working", async () => {
    const { update } = registerReady();
    await flushPresencePublishes();
    const ctx = update.mock.lastCall![0];
    expect(ctx.live).toEqual({ ready: false, note: "" });
    expect(ctx.users).toBe(ctx.everyone);
    const [{ user, live }] = ctx.users;
    expect(user).toMatchObject({ pid: playhtml.people.me.pid, isMe: true });
    expect(live).toEqual({ ready: false, note: "" });
    // The hidden aliases stay out of logs and equality checks.
    expect(Object.keys(ctx.everyone[0])).not.toContain("user");
    ctx.setLive({ ready: true, note: "" });
    expect(update.mock.lastCall![0].live).toEqual({ ready: true, note: "" });
  });

  it("handle reads and subscriptions work, including before the element binds", async () => {
    const handle = playhtml.register("late-card", {
      defaultPresence: { ready: false },
      update: () => {},
    });
    expect(handle.me.presence).toBeUndefined();
    expect(handle.everyone).toEqual([]);

    const callback = vi.fn();
    const unsubscribe = handle.onEveryoneChange("ready", callback);
    expect(callback).toHaveBeenLastCalledWith([]);

    const element = document.createElement("div");
    element.id = "late-card";
    document.body.append(element);
    playhtml.setupPlayElement(element);
    await flushPresencePublishes();

    expect(handle.me.presence).toEqual({ ready: false });
    expect(callback.mock.lastCall![0][0].presence).toEqual({ ready: false });
    const calls = callback.mock.calls.length;

    handle.setMyPresence({ ready: false });
    expect(callback).toHaveBeenCalledTimes(calls);
    handle.setMyPresence({ ready: true });
    expect(callback.mock.lastCall![0][0].presence).toEqual({ ready: true });

    unsubscribe();
    handle.setMyPresence({ ready: false });
    expect(callback.mock.lastCall![0][0].presence).toEqual({ ready: true });
  });

  it("rejects more than one presence default", () => {
    expect(() =>
      playhtml.register("two-defaults", {
        defaultPresence: {},
        live: {},
        update: () => {},
      } as any),
    ).toThrow(/defines `defaultPresence` and `live`/);
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

  it("room.people has the same API, scoped to the room", () => {
    const room = playhtml.createPresenceRoom("lobby-42");
    room.people.setMyPresence("ready", true);
    expect(room.people.everyone[0].presence).toEqual({ ready: true });
    expect(room.people.me.presence).toEqual({ ready: true });
    expect(room.people.me.pid).toBe(playhtml.people.me.pid);
    expect(playhtml.people.everyone[0].presence).toEqual({});
    room.destroy();
  });
});

describe("cursors on people", () => {
  beforeEach(async () => {
    document.body.innerHTML = "";
    (globalThis as any).PLAYHTML_TEST_PROVIDERS = [];
    await resetPlayHTML();
    await playhtml.init({ cursors: { enabled: true } });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
    await resetPlayHTML();
  });

  function receiveCursor(x: number) {
    receiveRemote({
      "conn-remote": {
        identity: mina,
        cursor: {
          cursor: { x, y: 5, pointer: "mouse" },
          page: "/",
          zone: null,
          at: Date.now(),
        },
      },
    });
  }

  it("puts each cursor at person.presence.cursor", () => {
    receiveCursor(10);
    const remote = playhtml.people.everyone.find((person) => person.pid === "pk_mina");
    expect(remote?.presence.cursor).toMatchObject({ x: 10, y: 5, pointer: "mouse", page: "/" });
  });

  it("onChange skips cursor moves unless you watch \"cursor\"", () => {
    const all = vi.fn();
    const cursorOnly = vi.fn();
    playhtml.people.onChange(all);
    playhtml.people.onChange("cursor", cursorOnly);
    receiveCursor(10);
    const allCalls = all.mock.calls.length;
    const cursorCalls = cursorOnly.mock.calls.length;

    receiveCursor(20);
    expect(all).toHaveBeenCalledTimes(allCalls);
    expect(cursorOnly.mock.calls.length).toBeGreaterThan(cursorCalls);
    const remote = cursorOnly.mock.lastCall![0].find((person: any) => person.pid === "pk_mina");
    expect(remote.presence.cursor.x).toBe(20);
  });
});
