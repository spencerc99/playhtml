// ABOUTME: Verifies presence transports are shared per room via refcounting.
// ABOUTME: Covers cursor teardown not closing sockets still used elsewhere.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { playhtml, resetPlayHTML } from "../index";
import {
  getPresenceSocketForRoom,
  getPresenceSockets,
  sentMessages,
} from "./presence-test-utils";

describe("presence transport sharing", () => {
  beforeEach(async () => {
    document.body.innerHTML = "";
    (globalThis as any).PLAYHTML_TEST_PROVIDERS = [];
    await resetPlayHTML();
  });

  afterEach(async () => {
    document.body.innerHTML = "";
    await resetPlayHTML();
  });

  it("opens exactly one presence socket when cursors share the page room", async () => {
    await playhtml.init({ cursors: { enabled: true } });
    const rooms = getPresenceSockets()
      .filter((socket) => !socket.closed)
      .map((socket) => socket.options.room);
    expect(rooms).toEqual([playhtml.roomId]);
  });

  it("closes presence sockets on resetPlayHTML", async () => {
    await playhtml.init({ cursors: { enabled: true } });
    await resetPlayHTML();
    expect(getPresenceSockets().every((socket) => socket.closed)).toBe(true);
  });

  it("shares one socket between cursors and element awareness on the page room", async () => {
    await playhtml.init({ cursors: { enabled: true } });
    const el = document.createElement("div");
    el.id = "shared-socket-card";
    el.setAttribute("can-play", "");
    (el as any).defaultData = {};
    (el as any).updateElement = () => {};
    document.body.appendChild(el);
    await playhtml.setupPlayElementForTag(el, "can-play");

    const openSockets = getPresenceSockets().filter((socket) => !socket.closed);
    expect(openSockets.map((socket) => socket.options.room)).toEqual([
      playhtml.roomId,
    ]);
  });

  it("opens a separate page-room socket when cursors use a domain room", async () => {
    await playhtml.init({ cursors: { enabled: true, room: "domain" } });
    const openRooms = getPresenceSockets()
      .filter((socket) => !socket.closed)
      .map((socket) => socket.options.room);
    expect(openRooms).toContain(playhtml.roomId);
    expect(openRooms).toHaveLength(2);
  });

  it("opens the page-room socket even when cursors are disabled", async () => {
    await playhtml.init({ cursors: { enabled: false } });
    const openRooms = getPresenceSockets()
      .filter((socket) => !socket.closed)
      .map((socket) => socket.options.room);
    expect(openRooms).toEqual([playhtml.roomId]);
  });

  it("publishes the same page on every join across the shared socket", async () => {
    await playhtml.init({ cursors: { enabled: true } });
    const socket = getPresenceSocketForRoom(playhtml.roomId);
    const joinMessages = sentMessages(socket).filter(
      (message) => message.type === "presence-join",
    );
    expect(joinMessages.length).toBeGreaterThan(0);
    for (const message of joinMessages) {
      expect(message.page).toBe(window.location.pathname);
    }
  });
});
