// ABOUTME: Verifies user identity persistence and transport-backed discovery.
// ABOUTME: Covers cursor-disabled peers, identity updates, and multi-tab deduplication.

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PlayerIdentity } from "@playhtml/common";
import { createUsersAPI, selectAllColors } from "../users";
import { createFakePresenceTransport } from "./presence-test-utils";

function makeIdentity(publicKey: string, color = "#123456", name?: string): PlayerIdentity {
  return { publicKey, name, playerStyle: { colorPalette: [color] } };
}

function makeUsers(identity = makeIdentity("self")) {
  const transport = createFakePresenceTransport();
  const users = createUsersAPI(identity, {
    getIdentityPeers: () => transport.peers.getPeers(),
    onIdentityPeersChange: (callback) => transport.peers.subscribe("identity", callback),
  });
  return { users, transport };
}

describe("users", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("always includes self when cursors are disabled", () => {
    const { users } = makeUsers(makeIdentity("self", "#abcdef", "Me"));
    expect(users.getAll()).toEqual([
      { pid: "self", name: "Me", color: "#abcdef", isMe: true },
    ]);
  });

  it("discovers identity-only peers and notifies on remote identity changes", () => {
    const { users, transport } = makeUsers();
    const snapshots: string[][] = [];
    users.onChange((next) => snapshots.push(next.map((user) => `${user.pid}:${user.name}`)));

    transport.emit({
      type: "presence-sync",
      peers: { tab1: { identity: makeIdentity("remote", "#00ff00", "Alice") } },
    });
    transport.emit({
      type: "presence-changes",
      updates: { tab1: { identity: makeIdentity("remote", "#00ff00", "Alicia") } },
      removes: {},
    });

    expect(snapshots.at(-1)).toEqual(["remote:Alicia", "self:undefined"]);
  });

  it("deduplicates multiple tabs by public key", () => {
    const { users, transport } = makeUsers();
    transport.emit({
      type: "presence-sync",
      peers: {
        tab1: { identity: makeIdentity("remote", "#00ff00", "Alice") },
        tab2: { identity: makeIdentity("remote", "#00ff00", "Alice") },
      },
    });
    expect(users.getAll().filter((user) => user.pid === "remote")).toHaveLength(1);
  });

  it("selects the same multi-tab identity regardless of snapshot order", () => {
    const { users, transport } = makeUsers();
    const first = { identity: makeIdentity("remote", "#00ff00", "First") };
    const last = { identity: makeIdentity("remote", "#0000ff", "Last") };
    transport.emit({ type: "presence-sync", peers: { a: first, z: last } });
    const expected = users.getAll();
    transport.emit({ type: "presence-sync", peers: { z: last, a: first } });
    expect(users.getAll()).toEqual(expected);
  });

  it("persists and emits self identity mutations", () => {
    const { users } = makeUsers();
    const changes = vi.fn();
    users.onSelfChange(changes);
    users.me.name = "Spencer";
    users.me.color = "#fedcba";
    expect(changes).toHaveBeenCalledTimes(2);
    expect(users.getIdentity()).toMatchObject({
      name: "Spencer",
      playerStyle: { colorPalette: ["#fedcba"] },
    });
  });

  it("onChange fires on self mutation", () => {
    const { users } = makeUsers(makeIdentity("local-key"));

    const seen: Array<Array<{ pid: string; name?: string }>> = [];
    users.onChange((all) => seen.push(all));
    const before = seen.length;

    users.me.name = "spencer";

    expect(seen.length).toBeGreaterThan(before);
    expect(seen.at(-1)!.find((user) => user.pid === "local-key")?.name).toBe(
      "spencer",
    );
  });

  it("notifies onChange when the full self identity changes", () => {
    const { users } = makeUsers(makeIdentity("local-key"));
    const listener = vi.fn();
    users.onChange(listener);
    listener.mockClear();

    users.adoptIdentity({
      ...makeIdentity("local-key"),
      playerStyle: {
        colorPalette: ["#111111"],
        cursorStyle: "crosshair",
      },
    });

    expect(listener).toHaveBeenCalledOnce();
  });

  it("does not notify onChange when only cursor position changes", () => {
    const transport = createFakePresenceTransport();
    const remoteIdentity = makeIdentity("remote-key", "#abcdef");
    let cursorPresences = new Map([
      [
        "remote-key",
        {
          cursor: { x: 0, y: 0, pointer: "mouse" },
          playerIdentity: remoteIdentity,
        },
      ],
    ]);
    let notifyCursorPresences = () => {};
    const users = createUsersAPI(makeIdentity("local-key"), {
      getIdentityPeers: () => transport.peers.getPeers(),
      onIdentityPeersChange: (callback) => transport.peers.subscribe("identity", callback),
      getCursorPresences: () => cursorPresences,
      onCursorPresencesChange(callback) {
        notifyCursorPresences = () => callback(cursorPresences);
        return () => {};
      },
    });
    const listener = vi.fn();
    users.onChange(listener);
    listener.mockClear();

    cursorPresences = new Map([
      [
        "remote-key",
        {
          cursor: { x: 10, y: 20, pointer: "mouse" },
          playerIdentity: remoteIdentity,
        },
      ],
    ]);
    notifyCursorPresences();

    expect(listener).not.toHaveBeenCalled();

    cursorPresences = new Map([
      [
        "remote-key",
        {
          cursor: { x: 10, y: 20, pointer: "mouse" },
          playerIdentity: makeIdentity("remote-key", "#fedcba"),
        },
      ],
    ]);
    notifyCursorPresences();

    expect(listener).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ pid: "remote-key", color: "#fedcba" }),
      ]),
    );
  });

  it("isolates throwing onChange subscribers during self mutation", () => {
    const { users } = makeUsers(makeIdentity("local-key"));
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
    const { users } = makeUsers(makeIdentity("local-key"));
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
