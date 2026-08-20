// ABOUTME: Verifies the page-presence "cursor" channel keeps firing across
// ABOUTME: cursor-client rebuilds (navigation + server room reset) via the hub.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { playhtml, resetPlayHTML } from "../index";
import { getPresenceSocketForRoom } from "./presence-test-utils";

function currentProvider(): any {
  const providers = (globalThis as any).PLAYHTML_TEST_PROVIDERS as any[];
  return providers[providers.length - 1];
}

/** Deliver a remote cursor frame on the page socket so the cursor client
 * re-renders and notifies its presence listeners (feeding the hub). */
function receiveRemoteCursor(room: string, publicKey: string, x: number): void {
  const socket = getPresenceSocketForRoom(room);
  socket.receive({
    type: "presence-sync",
    peers: {
      [`conn-${publicKey}`]: {
        identity: { publicKey, playerStyle: { colorPalette: ["#00ff00"] } },
        cursor: {
          cursor: { x, y: 5, pointer: "mouse" },
          page: "/",
          zone: null,
          at: Date.now(),
        },
      },
    },
  });
}

describe("page presence cursor channel across cursor rebuilds", () => {
  const origPath = window.location.pathname + window.location.search;

  beforeEach(async () => {
    document.body.innerHTML = "";
    (globalThis as any).PLAYHTML_TEST_PROVIDERS = [];
    await resetPlayHTML();
  });

  afterEach(async () => {
    history.replaceState(null, "", origPath);
    document.body.innerHTML = "";
    localStorage.clear();
    await resetPlayHTML();
  });

  it("fires the cursor subscription after page-room navigation", async () => {
    history.replaceState(null, "", "/cursor-nav-a");
    await playhtml.init({ cursors: { enabled: true } });

    const received: Array<Map<string, unknown>> = [];
    // Subscribe BEFORE navigation.
    playhtml.presence.onPresenceChange("cursor", (presences) => {
      received.push(presences as Map<string, unknown>);
    });

    history.replaceState(null, "", "/cursor-nav-b");
    await playhtml.handleNavigation();
    const roomB = playhtml.roomId;
    received.length = 0;

    // A remote cursor in the NEW room must reach the pre-nav subscription.
    receiveRemoteCursor(roomB, "pk_remote", 42);
    expect(received.length).toBeGreaterThan(0);
    expect(received.at(-1)!.has("pk_remote")).toBe(true);
  });

  it("fires the cursor subscription after a server room reset", async () => {
    history.replaceState(null, "", "/cursor-reset");
    await playhtml.init({
      host: "http://localhost:1999",
      room: "/cursor-reset",
      cursors: { enabled: true },
    } as any);
    const room = playhtml.roomId;

    const received: Array<Map<string, unknown>> = [];
    playhtml.presence.onPresenceChange("cursor", (presences) => {
      received.push(presences as Map<string, unknown>);
    });

    // Server orders a room reset — cursors are torn down and rebuilt.
    currentProvider().emit(
      "custom-message",
      JSON.stringify({ type: "room-reset", resetEpoch: 7 }),
    );
    await new Promise((r) => queueMicrotask(r));
    await new Promise((r) => queueMicrotask(r));
    received.length = 0;

    // The pre-reset subscription must still fire for cursors in the reset room.
    receiveRemoteCursor(room, "pk_after_reset", 13);
    expect(received.length).toBeGreaterThan(0);
    expect(received.at(-1)!.has("pk_after_reset")).toBe(true);
  });

  it("does not fire a pre-reset cursor subscription after a full resetPlayHTML", async () => {
    // resetPlayHTML discards the facade without unsubscribing its cursor-channel
    // wrappers; the hub subscriber set must be cleared so a stale wrapper (from
    // the destroyed presence client) does not keep firing on the fresh instance.
    history.replaceState(null, "", "/leak-a");
    await playhtml.init({ cursors: { enabled: true } });
    let staleFired = false;
    playhtml.presence.onPresenceChange("cursor", () => {
      staleFired = true;
    });

    await resetPlayHTML();
    (globalThis as any).PLAYHTML_TEST_PROVIDERS = [];

    history.replaceState(null, "", "/leak-b");
    await playhtml.init({ cursors: { enabled: true } });
    staleFired = false;

    // A cursor frame on the fresh instance must NOT reach the old subscription.
    receiveRemoteCursor(playhtml.roomId, "pk_fresh", 9);
    expect(staleFired).toBe(false);
  });
});
