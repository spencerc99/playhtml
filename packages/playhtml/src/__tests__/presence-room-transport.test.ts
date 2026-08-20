// ABOUTME: Verifies createPresenceRoom runs over an isolated presence transport
// ABOUTME: socket that never leaks into the page room and closes on destroy.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { playhtml, resetPlayHTML } from "../index";
import {
  getPresenceSockets,
  sentChannelUpdates,
  sentMessages,
  sentPresenceValues,
} from "./presence-test-utils";

function socketForRoomIncludingClosed(room: string) {
  return getPresenceSockets().find((socket) => socket.options.room === room);
}

describe("createPresenceRoom over the transport", () => {
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

  it("opens a dedicated socket on a room distinct from the page room", () => {
    const room = playhtml.createPresenceRoom("lobby");
    try {
      const openRooms = getPresenceSockets()
        .filter((socket) => !socket.closed)
        .map((socket) => socket.options.room);
      // Page room + the new lobby room, both distinct.
      expect(openRooms).toContain(playhtml.roomId);
      const lobbyRoom = openRooms.find((r) => r !== playhtml.roomId);
      expect(lobbyRoom).toBeDefined();
      expect(lobbyRoom).not.toBe(playhtml.roomId);
    } finally {
      room.destroy();
    }
  });

  it("publishes room presence on the lobby socket, not the page socket", () => {
    const room = playhtml.createPresenceRoom("lobby");
    try {
      const lobbySocket = getPresenceSockets().find(
        (socket) => socket.options.room !== playhtml.roomId && !socket.closed,
      )!;
      // Force the socket open so queued join/updates flush (mirrors reconnect).
      lobbySocket.open();
      room.presence.setMyPresence("page", { url: "/a" });
      expect(sentPresenceValues(lobbySocket, "presence:page")).toContainEqual({
        url: "/a",
      });

      // The page room socket never saw the lobby's presence:page update.
      const pageSocket = getPresenceSockets().find(
        (socket) => socket.options.room === playhtml.roomId && !socket.closed,
      )!;
      expect(sentChannelUpdates(pageSocket, "presence:page")).toHaveLength(0);
    } finally {
      room.destroy();
    }
  });

  it("joins the lobby room with the persistent identity", () => {
    const room = playhtml.createPresenceRoom("lobby");
    try {
      const lobbySocket = getPresenceSockets().find(
        (socket) => socket.options.room !== playhtml.roomId && !socket.closed,
      )!;
      lobbySocket.open();
      const join = sentMessages(lobbySocket).find(
        (message) => message.type === "presence-join",
      );
      expect(join.identity.publicKey).toBe(
        playhtml.presence.getMyIdentity().publicKey,
      );
    } finally {
      room.destroy();
    }
  });

  it("reflects a remote lobby peer keyed by publicKey", () => {
    const room = playhtml.createPresenceRoom("lobby");
    try {
      const lobbySocket = getPresenceSockets().find(
        (socket) => socket.options.room !== playhtml.roomId && !socket.closed,
      )!;
      lobbySocket.receive({
        type: "presence-sync",
        peers: {
          "conn-2": {
            identity: {
              publicKey: "pk_lobby_remote",
              playerStyle: { colorPalette: ["green"] },
            },
            "presence:page": { url: "/b" },
          },
        },
      });
      const presences = room.presence.getPresences();
      expect((presences.get("pk_lobby_remote") as any).page).toEqual({
        url: "/b",
      });
    } finally {
      room.destroy();
    }
  });

  it("destroy closes the lobby socket", () => {
    const room = playhtml.createPresenceRoom("lobby");
    const lobbyRoom = getPresenceSockets()
      .filter((socket) => !socket.closed)
      .map((socket) => socket.options.room)
      .find((r) => r !== playhtml.roomId)!;
    room.destroy();
    const socket = socketForRoomIncludingClosed(lobbyRoom)!;
    expect(socket.closed).toBe(true);
    // The page room socket stays open.
    const pageSocket = socketForRoomIncludingClosed(playhtml.roomId)!;
    expect(pageSocket.closed).toBe(false);
  });

  it("distinct room names open distinct sockets", () => {
    const roomA = playhtml.createPresenceRoom("room-a");
    const roomB = playhtml.createPresenceRoom("room-b");
    try {
      const openRooms = getPresenceSockets()
        .filter((socket) => !socket.closed)
        .map((socket) => socket.options.room)
        .filter((r) => r !== playhtml.roomId);
      expect(new Set(openRooms).size).toBe(2);
    } finally {
      roomA.destroy();
      roomB.destroy();
    }
  });
});
