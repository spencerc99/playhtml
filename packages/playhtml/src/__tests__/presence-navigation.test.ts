// ABOUTME: Verifies presence + element awareness survive page-room navigation:
// ABOUTME: stable facade, retained subscriptions, and reseeded element awareness.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { elementHandlers, playhtml, resetPlayHTML } from "../index";
import {
  flushMicrotasks,
  getPresenceSocketForRoom,
  getPresenceSockets,
  sentChannelUpdates,
} from "./presence-test-utils";

describe("presence across navigation", () => {
  const origPath = window.location.pathname + window.location.search;

  beforeEach(async () => {
    document.body.innerHTML = "";
    (globalThis as any).PLAYHTML_TEST_PROVIDERS = [];
    await resetPlayHTML();
  });

  afterEach(async () => {
    history.replaceState(null, "", origPath);
    document.body.innerHTML = "";
    await resetPlayHTML();
  });

  function addCanPlayElement(id: string) {
    const el = document.createElement("div");
    el.id = id;
    el.setAttribute("can-play", "");
    (el as any).defaultData = {};
    (el as any).updateElement = () => {};
    document.body.appendChild(el);
    return el;
  }

  it("returns the SAME presence object before and after navigation", async () => {
    history.replaceState(null, "", "/facade-a");
    await playhtml.init({ cursors: { enabled: false } });
    const before = playhtml.presence;

    history.replaceState(null, "", "/facade-b");
    await playhtml.handleNavigation();

    expect(playhtml.presence).toBe(before);
  });

  it("routes a write from a captured reference to the NEW room after navigation", async () => {
    history.replaceState(null, "", "/write-a");
    await playhtml.init({ cursors: { enabled: false } });
    const roomA = playhtml.roomId;
    const capturedPresence = playhtml.presence;

    history.replaceState(null, "", "/write-b");
    await playhtml.handleNavigation();
    const roomB = playhtml.roomId;
    expect(roomB).not.toBe(roomA);

    // Write through the reference captured before navigation.
    capturedPresence.setMyPresence("status", { text: "post-nav" });

    const socketB = getPresenceSocketForRoom(roomB);
    expect(sentChannelUpdates(socketB, "presence:status")).toContainEqual({
      text: "post-nav",
    });
    // The old room's socket never saw the post-nav write.
    const socketA = getPresenceSockets().find(
      (socket) => socket.options.room === roomA,
    )!;
    expect(sentChannelUpdates(socketA, "presence:status")).toHaveLength(0);
  });

  it("delivers post-navigation updates to a subscription registered before navigation", async () => {
    history.replaceState(null, "", "/sub-a");
    await playhtml.init({ cursors: { enabled: false } });

    const received: Array<Map<string, unknown>> = [];
    // Subscribe before navigation.
    const unsub = playhtml.presence.onPresenceChange("status", (presences) => {
      received.push(presences as Map<string, unknown>);
    });

    history.replaceState(null, "", "/sub-b");
    await playhtml.handleNavigation();
    const roomB = playhtml.roomId;
    received.length = 0;

    // A peer publishes in the NEW room; the pre-nav callback must still fire.
    const socketB = getPresenceSocketForRoom(roomB);
    socketB.receive({
      type: "presence-changes",
      updates: {
        "conn-2": {
          identity: {
            publicKey: "pk_remote",
            playerStyle: { colorPalette: ["blue"] },
          },
          "presence:status": { text: "in-new-room" },
        },
      },
      removes: {},
    });

    expect(received.length).toBeGreaterThan(0);
    const last = received.at(-1)!;
    expect((last.get("pk_remote") as any).status).toEqual({
      text: "in-new-room",
    });

    // Unsubscribe function returned before navigation still works.
    unsub();
    received.length = 0;
    socketB.receive({
      type: "presence-changes",
      updates: {
        "conn-2": { "presence:status": { text: "after-unsub" } },
      },
      removes: {},
    });
    expect(received).toHaveLength(0);
  });

  it("reseeds retained element awareness into the new room without a user action", async () => {
    history.replaceState(null, "", "/seed-a");
    await playhtml.init({ cursors: { enabled: false } });

    const el = addCanPlayElement("retained-card");
    await playhtml.setupPlayElementForTag(el, "can-play");
    elementHandlers.get("can-play")!.get("retained-card")!
      .setMyAwareness({ here: true } as any);
    await flushMicrotasks();

    // Element stays mounted across navigation.
    history.replaceState(null, "", "/seed-b");
    await playhtml.handleNavigation();
    const roomB = playhtml.roomId;
    await flushMicrotasks();

    // The new room's socket receives the retained awareness with no further
    // setMyAwareness call.
    const socketB = getPresenceSocketForRoom(roomB);
    expect(sentChannelUpdates(socketB, "element:shard:0").at(-1)).toEqual({
      v: 1,
      entries: [["can-play", "retained-card", { here: true }]],
    });
  });

  it("seeds all retained handlers in a single coalesced publish", async () => {
    history.replaceState(null, "", "/seed-batch-a");
    await playhtml.init({ cursors: { enabled: false } });

    for (let i = 0; i < 5; i += 1) {
      const el = addCanPlayElement(`batch-${i}`);
      await playhtml.setupPlayElementForTag(el, "can-play");
      elementHandlers.get("can-play")!.get(`batch-${i}`)!
        .setMyAwareness({ i } as any);
    }
    await flushMicrotasks();

    history.replaceState(null, "", "/seed-batch-b");
    await playhtml.handleNavigation();
    const roomB = playhtml.roomId;
    const socketB = getPresenceSocketForRoom(roomB);
    const before = sentChannelUpdates(socketB, "element:shard:0").length;
    await flushMicrotasks();

    const after = sentChannelUpdates(socketB, "element:shard:0");
    // The seed is one coalesced publish, not one per element.
    expect(after.length - before).toBeLessThanOrEqual(1);
    // And it carries every retained element.
    const seeded = JSON.stringify(after.at(-1));
    expect(seeded).toContain("batch-0");
    expect(seeded).toContain("batch-4");
  });
});
