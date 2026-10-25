// ABOUTME: Verifies element user lists across absent, local, and remote live state.
// ABOUTME: Ensures ordinary shared-data updates do not rebuild an unused room roster.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { playhtml, resetPlayHTML } from "../index";
import {
  flushPresencePublishes,
  getPresenceSocketForRoom,
} from "./presence-test-utils";

describe("element users", () => {
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

  function registerElement() {
    const element = document.createElement("div");
    element.id = "users-card";
    document.body.append(element);
    const update = vi.fn();
    const handle = playhtml.register(element, {
      defaultData: { count: 0 },
      update,
    });
    return { handle, update };
  }

  it("skips the room roster for shared-data updates without live state", async () => {
    const { handle, update } = registerElement();
    await flushPresencePublishes();
    const getAll = vi.spyOn(playhtml.users, "getAll");
    update.mockClear();

    handle.setData((data) => {
      data.count += 1;
    });
    await flushPresencePublishes();

    expect(handle.getData()).toEqual({ count: 1 });
    expect(update).toHaveBeenCalledTimes(1);
    expect(update.mock.calls[0][0].users).toEqual([]);
    expect(getAll).not.toHaveBeenCalled();
  });

  it("keeps falsy local live values in the user list", async () => {
    const { handle, update } = registerElement();
    await flushPresencePublishes();

    for (const live of [false, 0, null]) {
      handle.setLive(live);
      expect(update.mock.calls.at(-1)![0].users).toEqual([
        {
          user: expect.objectContaining({
            pid: playhtml.users.me.pid,
            isMe: true,
          }),
          presence: live,
        },
      ]);
      // 2.15 entries exposed the value as `live`; it stays as an alias.
      expect(update.mock.calls.at(-1)![0].users[0].live).toBe(live);
    }
  });

  it("joins remote live state and skips the roster again after the last peer leaves", async () => {
    const { handle, update } = registerElement();
    await flushPresencePublishes();
    const socket = getPresenceSocketForRoom(playhtml.roomId);
    socket.receive({
      type: "presence-sync",
      peers: {
        remote: {
          identity: {
            publicKey: "remote-user",
            name: "Mina",
            playerStyle: { colorPalette: ["blue"] },
          },
          "element:shard:0": {
            v: 1,
            entries: [["can-play", "users-card", false]],
          },
        },
      },
    });
    expect(update.mock.calls.at(-1)![0].users).toEqual([
      {
        user: { pid: "remote-user", name: "Mina", color: "blue", isMe: false },
        presence: false,
      },
    ]);

    socket.receive({
      type: "presence-changes",
      updates: {},
      removes: { remote: ["identity", "element:shard:0"] },
    });
    expect(update.mock.calls.at(-1)![0].users).toEqual([]);
    await flushPresencePublishes();
    const getAll = vi.spyOn(playhtml.users, "getAll");
    handle.setData({ count: 2 });
    await flushPresencePublishes();
    expect(update.mock.calls.at(-1)![0].users).toEqual([]);
    expect(getAll).not.toHaveBeenCalled();
  });
});
