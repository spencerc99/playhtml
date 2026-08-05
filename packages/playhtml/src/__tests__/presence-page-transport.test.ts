// ABOUTME: Verifies playhtml.presence publishes page presence over the shared
// ABOUTME: presence transport, keyed by identity, and cleans up on reset.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { playhtml, resetPlayHTML } from "../index";
import {
  getPresenceSocketForRoom,
  getPresenceSockets,
  sentMessages,
  sentPresenceValues,
} from "./presence-test-utils";

describe("page presence over the transport", () => {
  beforeEach(async () => {
    document.body.innerHTML = "";
    (globalThis as any).PLAYHTML_TEST_PROVIDERS = [];
    await resetPlayHTML();
    await playhtml.init({ cursors: { enabled: false } });
    await new Promise((resolve) => queueMicrotask(resolve));
  });

  afterEach(async () => {
    document.body.innerHTML = "";
    await resetPlayHTML();
  });

  it("publishes setMyPresence on the page room socket under presence:<channel>", () => {
    playhtml.presence.setMyPresence("status", { text: "online" });
    const socket = getPresenceSocketForRoom(playhtml.roomId);
    expect(sentPresenceValues(socket, "presence:status")).toContainEqual({
      text: "online",
    });
  });

  it("shares the page room socket with element awareness (no extra socket)", () => {
    playhtml.presence.setMyPresence("status", { text: "online" });
    const openRooms = getPresenceSockets()
      .filter((socket) => !socket.closed)
      .map((socket) => socket.options.room);
    expect(openRooms).toEqual([playhtml.roomId]);
  });

  it("clears a channel via presence-clear when set to null", () => {
    playhtml.presence.setMyPresence("status", { text: "online" });
    playhtml.presence.setMyPresence("status", null);
    const socket = getPresenceSocketForRoom(playhtml.roomId);
    const clears = sentMessages(socket).filter(
      (message) =>
        message.type === "presence-clear" &&
        message.channel === "presence:status",
    );
    expect(clears.length).toBeGreaterThan(0);
  });

  it("reflects a remote peer's presence keyed by publicKey", () => {
    const socket = getPresenceSocketForRoom(playhtml.roomId);
    const myPid = playhtml.presence.getMyIdentity().publicKey;
    socket.receive({
      type: "presence-sync",
      peers: {
        "conn-2": {
          identity: {
            publicKey: "pk_remote",
            playerStyle: { colorPalette: ["blue"] },
          },
          "presence:status": { text: "typing" },
        },
      },
    });
    const presences = playhtml.presence.getPresences();
    expect(presences.get("pk_remote")).toBeDefined();
    expect((presences.get("pk_remote") as any).status).toEqual({ text: "typing" });
    // Self remains keyed by our own publicKey.
    expect(presences.get(myPid)!.isMe).toBe(true);
  });

  it("onPresenceChange fires when a peer publishes that channel", () => {
    const socket = getPresenceSocketForRoom(playhtml.roomId);
    const received: Array<unknown> = [];
    const unsub = playhtml.presence.onPresenceChange("status", (presences) => {
      received.push(presences);
    });
    received.length = 0;
    socket.receive({
      type: "presence-changes",
      updates: {
        "conn-2": {
          identity: {
            publicKey: "pk_remote",
            playerStyle: { colorPalette: ["blue"] },
          },
          "presence:status": { text: "available" },
        },
      },
      removes: {},
    });
    expect(received.length).toBe(1);
    unsub();
  });

  it("closes the page presence socket on resetPlayHTML", async () => {
    playhtml.presence.setMyPresence("status", { text: "online" });
    await resetPlayHTML();
    expect(getPresenceSockets().every((socket) => socket.closed)).toBe(true);
  });
});
