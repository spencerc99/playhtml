// ABOUTME: Verifies runtime cursor filters immediately replace already-rendered cursors.
// ABOUTME: Covers custom presence views that take over rendering without another pointer move.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { playhtml, resetPlayHTML } from "../index";
import { getPresenceSocketForRoom } from "./presence-test-utils";

describe("runtime cursor rendering filters", () => {
  beforeEach(async () => {
    vi.useFakeTimers();
    document.body.innerHTML = "";
    await resetPlayHTML();
  });

  afterEach(async () => {
    vi.useRealTimers();
    document.body.innerHTML = "";
    localStorage.clear();
    await resetPlayHTML();
  });

  it("removes an existing cursor as soon as shouldRenderCursor changes", async () => {
    await playhtml.init({
      room: "/cursor-render-filter",
      cursors: { enabled: true },
    });
    const socket = getPresenceSocketForRoom(playhtml.roomId);
    socket.receive({
      type: "presence-sync",
      peers: {
        "remote-connection": {
          identity: {
            publicKey: "remote-rider",
            playerStyle: { colorPalette: ["#4a9a8a"] },
          },
          cursor: {
            cursor: { x: 40, y: 40, pointer: "mouse" },
            page: "/",
            zone: null,
            at: Date.now(),
          },
        },
      },
    });

    expect(document.querySelector(".playhtml-cursor-other")).not.toBeNull();

    playhtml.cursorClient!.configure({
      shouldRenderCursor: (presence) =>
        presence.playerIdentity?.publicKey !== "remote-rider",
    });
    expect(
      document
        .querySelector(".playhtml-cursor-other")
        ?.classList.contains("playhtml-cursor-fade-out"),
    ).toBe(true);

    await vi.advanceTimersByTimeAsync(300);
    expect(document.querySelector(".playhtml-cursor-other")).toBeNull();

    playhtml.cursorClient!.configure({
      shouldRenderCursor: () => true,
    });
    expect(document.querySelector(".playhtml-cursor-other")).not.toBeNull();
  });
});
