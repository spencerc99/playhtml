// ABOUTME: Verifies playhtml.users.me persistence, mutation, and change notification.
// ABOUTME: Covers identity publication, array snapshots, color selection, and subscriptions.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  createUsersAPI,
  selectAllColors,
  type UsersAwarenessLike,
} from "../users";
import { PLAYER_IDENTITY_STORAGE_KEY, type PlayerIdentity } from "@playhtml/common";

function makeIdentity(publicKey: string, color = "#111111"): PlayerIdentity {
  return {
    publicKey,
    playerStyle: { colorPalette: [color] },
  } as PlayerIdentity;
}

function makeAwareness(clientID = 1): UsersAwarenessLike & {
  states: Map<number, Record<string, unknown>>;
  emitChange: () => void;
} {
  const states = new Map<number, Record<string, unknown>>();
  const listeners = new Set<(...args: unknown[]) => void>();
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
    on(event, cb) {
      if (event === "change") listeners.add(cb);
    },
    emitChange() {
      for (const listener of listeners) listener();
    },
  };
}

describe("playhtml.users.me", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("persists color and name mutations", () => {
    const awareness = makeAwareness();
    const users = createUsersAPI(makeIdentity("local-key"), {
      getAwareness: () => awareness,
    });

    users.me.color = "#222222";
    users.me.name = "Ada";

    const stored = JSON.parse(localStorage.getItem(PLAYER_IDENTITY_STORAGE_KEY)!);
    expect(stored).toMatchObject({
      publicKey: "local-key",
      name: "Ada",
      playerStyle: { colorPalette: ["#222222"] },
    });
  });

  it("publishes __playhtml_identity__ at init and on every change", () => {
    const awareness = makeAwareness();
    const identity = {
      ...makeIdentity("local-key", "#111111"),
      source: "local" as const,
    };
    const users = createUsersAPI(identity, {
      getAwareness: () => awareness,
    });

    const published = awareness.getLocalState()?.[
      "__playhtml_identity__"
    ] as PlayerIdentity;
    expect(published.publicKey).toBe("local-key");
    expect(published).not.toHaveProperty("source");
    expect(users.getIdentity().source).toBe("local");

    users.me.color = "#222222";
    expect(
      (awareness.getLocalState()?.["__playhtml_identity__"] as PlayerIdentity)
        .playerStyle.colorPalette[0],
    ).toBe("#222222");

    users.me.name = "ada";
    expect(
      (awareness.getLocalState()?.["__playhtml_identity__"] as PlayerIdentity).name,
    ).toBe("ada");
  });

  it("getAll() includes self and a remote identity from __playhtml_identity__", () => {
    const awareness = makeAwareness(1);
    const users = createUsersAPI(makeIdentity("local-key", "#111111"), {
      getAwareness: () => awareness,
    });

    awareness.states.set(2, {
      __playhtml_identity__: makeIdentity("remote-key", "#abcdef"),
    });

    const all = users.getAll();
    expect(all).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ pid: "local-key", isMe: true }),
      ]),
    );
    expect(all.find((user) => user.pid === "remote-key")).toMatchObject({
      pid: "remote-key",
      color: "#abcdef",
      isMe: false,
    });
  });

  it("getAll() falls back to the cursor awareness field's playerIdentity", () => {
    const awareness = makeAwareness(1);
    const users = createUsersAPI(makeIdentity("local-key"), {
      getAwareness: () => awareness,
    });

    awareness.states.set(2, {
      __playhtml_cursors__: { playerIdentity: makeIdentity("remote-cursor-key", "#00ff00") },
    });

    const all = users.getAll();
    expect(all.find((user) => user.pid === "remote-cursor-key")).toMatchObject({
      pid: "remote-cursor-key",
      color: "#00ff00",
      isMe: false,
    });
  });

  it("onChange fires on a remote identity change and returns unsubscribe", () => {
    const awareness = makeAwareness(1);
    const users = createUsersAPI(makeIdentity("local-key"), {
      getAwareness: () => awareness,
    });

    const seen: Array<Array<{ pid: string }>> = [];
    const unsub = users.onChange((all) => seen.push(all));
    const callsAfterSubscribe = seen.length;

    awareness.states.set(2, {
      __playhtml_identity__: makeIdentity("remote-key", "#abcdef"),
    });
    awareness.emitChange();

    expect(seen.length).toBeGreaterThan(callsAfterSubscribe);
    expect(seen.at(-1)?.some((user) => user.pid === "remote-key")).toBe(true);

    unsub();
  });

  it("onChange fires on self mutation", () => {
    const awareness = makeAwareness();
    const users = createUsersAPI(makeIdentity("local-key"), {
      getAwareness: () => awareness,
    });

    const seen: Array<Array<{ pid: string; name?: string }>> = [];
    users.onChange((all) => seen.push(all));
    const before = seen.length;

    users.me.name = "spencer";

    expect(seen.length).toBeGreaterThan(before);
    expect(seen.at(-1)!.find((user) => user.pid === "local-key")?.name).toBe(
      "spencer",
    );
  });

  it("isolates throwing onChange subscribers during self mutation", () => {
    const awareness = makeAwareness();
    const users = createUsersAPI(makeIdentity("local-key"), {
      getAwareness: () => awareness,
    });
    const callbackError = new Error("onChange failed");
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    let throwOnNotification = false;
    users.onChange(() => {
      if (throwOnNotification) throw callbackError;
    });
    const laterSubscriber = vi.fn();
    users.onChange(laterSubscriber);
    laterSubscriber.mockClear();
    throwOnNotification = true;

    expect(() => {
      users.me.name = "spencer";
    }).not.toThrow();

    expect(users.me.name).toBe("spencer");
    expect(laterSubscriber).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ pid: "local-key", name: "spencer" }),
      ]),
    );
    expect(consoleError).toHaveBeenCalledWith(
      "[playhtml] users change subscriber threw:",
      callbackError,
    );
  });

  it("isolates throwing onSelfChange subscribers during self mutation", () => {
    const awareness = makeAwareness();
    const users = createUsersAPI(makeIdentity("local-key"), {
      getAwareness: () => awareness,
    });
    const callbackError = new Error("onSelfChange failed");
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    users.onSelfChange(() => {
      throw callbackError;
    });
    const laterSubscriber = vi.fn();
    users.onSelfChange(laterSubscriber);

    expect(() => {
      users.me.name = "spencer";
    }).not.toThrow();

    expect(users.me.name).toBe("spencer");
    expect(laterSubscriber).toHaveBeenCalledWith(users.getIdentity());
    expect(consoleError).toHaveBeenCalledWith(
      "[playhtml] users self-change subscriber threw:",
      callbackError,
    );
  });

  it("selects unique primary colors in user order", () => {
    expect(
      selectAllColors([
        { pid: "a", color: "#111111", isMe: true },
        { pid: "b", color: "#222222", isMe: false },
        { pid: "c", color: "#111111", isMe: false },
      ]),
    ).toEqual(["#111111", "#222222"]);
  });
});
