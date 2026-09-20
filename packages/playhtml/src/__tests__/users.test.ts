// ABOUTME: Verifies user identity persistence and transport-backed discovery.
// ABOUTME: Covers cursor-disabled peers, identity updates, and multi-tab deduplication.

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PlayerIdentity } from "@playhtml/common";
import { createUsersAPI } from "../users";
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
});
