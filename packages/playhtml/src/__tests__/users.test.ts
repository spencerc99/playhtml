// ABOUTME: Verifies playhtml.users.me persistence, mutation, and change notification.
// ABOUTME: Covers replace-all/merge/delete semantics, ephemeral keys, the size cap, getAll, and onChange.

import { describe, it, expect, beforeEach } from "vitest";
import { createUsersAPI, type UsersAwarenessLike } from "../users";
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

  it("replaces the whole custom bag and persists it", () => {
    const awareness = makeAwareness();
    const users = createUsersAPI(makeIdentity("local-key"), {
      getAwareness: () => awareness,
    });

    users.me.custom = { mood: "curious" };
    expect(users.me.custom).toEqual({ mood: "curious" });

    users.me.custom = { mood: "sleepy", streak: 3 };
    expect(users.me.custom).toEqual({ mood: "sleepy", streak: 3 });
  });

  it("setCustom merges a single key without touching others", () => {
    const awareness = makeAwareness();
    const users = createUsersAPI(makeIdentity("local-key"), {
      getAwareness: () => awareness,
    });

    users.me.custom = { mood: "curious", streak: 3 };
    users.me.setCustom("mood", "sleepy");

    expect(users.me.custom).toEqual({ mood: "sleepy", streak: 3 });
  });

  it("setCustom deletes the key when value is undefined", () => {
    const awareness = makeAwareness();
    const users = createUsersAPI(makeIdentity("local-key"), {
      getAwareness: () => awareness,
    });

    users.me.custom = { mood: "curious", streak: 3 };
    users.me.setCustom("mood", undefined);

    expect(users.me.custom).toEqual({ streak: 3 });
  });

  it("keeps persist:false keys in the published identity but strips them from localStorage", () => {
    const awareness = makeAwareness();
    const users = createUsersAPI(makeIdentity("local-key"), {
      getAwareness: () => awareness,
    });

    users.me.setCustom("streak", 3);
    users.me.setCustom("typing", true, { persist: false });

    expect(users.me.custom).toEqual({ streak: 3, typing: true });

    const stored = JSON.parse(localStorage.getItem(PLAYER_IDENTITY_STORAGE_KEY)!);
    expect(stored.custom).toEqual({ streak: 3 });
  });

  it("clears ephemeral marks when the whole bag is replaced", () => {
    const awareness = makeAwareness();
    const users = createUsersAPI(makeIdentity("local-key"), {
      getAwareness: () => awareness,
    });

    users.me.setCustom("typing", true, { persist: false });
    users.me.custom = { typing: true };

    const stored = JSON.parse(localStorage.getItem(PLAYER_IDENTITY_STORAGE_KEY)!);
    expect(stored.custom).toEqual({ typing: true });
  });

  it("throws when the custom bag exceeds 1024 bytes", () => {
    const awareness = makeAwareness();
    const users = createUsersAPI(makeIdentity("local-key"), {
      getAwareness: () => awareness,
    });

    expect(() => {
      users.me.custom = { blob: "x".repeat(1024) };
    }).toThrow("identity.custom must be 1024 bytes or less");

    expect(() => {
      users.me.setCustom("blob", "x".repeat(1024));
    }).toThrow("identity.custom must be 1024 bytes or less");
  });

  it("republishes __playhtml_identity__ to main-room awareness on every change", () => {
    const awareness = makeAwareness();
    const users = createUsersAPI(makeIdentity("local-key", "#111111"), {
      getAwareness: () => awareness,
    });

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
    expect(all.get("local-key")).toMatchObject({ pid: "local-key", isMe: true });
    expect(all.get("remote-key")).toMatchObject({
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
    expect(all.get("remote-cursor-key")).toMatchObject({
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

    const seen: Array<Map<string, unknown>> = [];
    const unsub = users.onChange((all) => seen.push(all));
    const callsAfterSubscribe = seen.length;

    awareness.states.set(2, {
      __playhtml_identity__: makeIdentity("remote-key", "#abcdef"),
    });
    awareness.emitChange();

    expect(seen.length).toBeGreaterThan(callsAfterSubscribe);
    expect(seen.at(-1)?.get("remote-key")).toBeDefined();

    unsub();
  });

  it("onChange fires on self mutation", () => {
    const awareness = makeAwareness();
    const users = createUsersAPI(makeIdentity("local-key"), {
      getAwareness: () => awareness,
    });

    const seen: Array<Map<string, unknown>> = [];
    users.onChange((all) => seen.push(all));
    const before = seen.length;

    users.me.name = "spencer";

    expect(seen.length).toBeGreaterThan(before);
    expect((seen.at(-1)!.get("local-key") as any)?.name).toBe("spencer");
  });
});
