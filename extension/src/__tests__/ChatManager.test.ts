// ABOUTME: Tests for ChatManager — ring buffer, send/throttle, profanity block, presence wiring.
// ABOUTME: Uses a fake PresenceAPI to drive onPresenceChange callbacks deterministically.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import browser from "webextension-polyfill";
import type { PresenceAPI, PresenceView } from "@playhtml/common";
import { ChatManager } from "../features/ChatManager";
import { _resetForTest as resetHandle } from "../features/chat-handle";

function setupStorage(value: string | null = null): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  if (value !== null) data["wiki_chat_handle"] = value;
  vi.mocked(browser.storage.local.get).mockImplementation((keys: any) => {
    if (typeof keys === "string") return Promise.resolve({ [keys]: data[keys] });
    if (Array.isArray(keys)) {
      const out: Record<string, unknown> = {};
      keys.forEach((k) => {
        out[k] = data[k];
      });
      return Promise.resolve(out);
    }
    return Promise.resolve({ ...data });
  });
  vi.mocked(browser.storage.local.set).mockImplementation((items: any) => {
    Object.assign(data, items);
    return Promise.resolve();
  });
  return data;
}

function makeFakePresence(
  initialPresences: Map<string, PresenceView> = new Map(),
): {
  api: PresenceAPI;
  emit: (presences: Map<string, PresenceView>) => void;
  getLastSent: () => unknown;
} {
  let chatChangeCb: ((p: Map<string, PresenceView>) => void) | null = null;
  let lastSent: unknown = null;
  const myIdentity = {
    publicKey: "self",
    playerStyle: { colorPalette: ["#c4724e"] },
  } as any;
  const api: PresenceAPI = {
    setMyPresence: (channel, data) => {
      if (channel === "chat") {
        lastSent = data;
        // Mimic Y.js awareness: setLocalStateField fires listeners synchronously.
        // This is what caused the dedupe-before-optimistic-append bug.
        const ownView: PresenceView = {
          playerIdentity: {
            publicKey: "self",
            playerStyle: { colorPalette: ["#c4724e"] },
          } as any,
          cursor: null,
          isMe: true,
          chat: data,
        } as PresenceView;
        chatChangeCb?.(new Map([["self", ownView]]));
      }
    },
    getPresences: () => new Map(),
    onPresenceChange: (channel, cb) => {
      if (channel === "chat") {
        chatChangeCb = cb;
        // Mirror the real API: replay the current snapshot on subscribe.
        cb(initialPresences);
      }
      return () => {};
    },
    getMyIdentity: () => myIdentity,
  };
  return {
    api,
    emit: (p) => chatChangeCb?.(p),
    getLastSent: () => lastSent,
  };
}

function peerView(pid: string, color: string, chat: unknown): PresenceView {
  return {
    playerIdentity: {
      publicKey: pid,
      playerStyle: { colorPalette: [color] },
    } as any,
    cursor: null,
    isMe: false,
    chat,
  } as PresenceView;
}

describe("ChatManager", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupStorage("TestHandle");
    resetHandle();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("starts with empty state and loads handle on init", async () => {
    const fake = makeFakePresence();
    const mgr = new ChatManager(fake.api, "Octopus");
    await mgr.init();
    expect(mgr.getState().messages).toEqual([]);
    expect(mgr.getState().handle).toBe("TestHandle");
    expect(mgr.getState().articleTitle).toBe("Octopus");
    expect(mgr.getState().isOpen).toBe(false);
    expect(mgr.getState().unread).toBe(false);
    mgr.destroy();
  });

  it("send broadcasts via setMyPresence and appends locally", async () => {
    const fake = makeFakePresence();
    const mgr = new ChatManager(fake.api, "Octopus");
    await mgr.init();
    mgr.send("hello world");
    const sent = fake.getLastSent() as any;
    expect(sent.text).toBe("hello world");
    expect(sent.name).toBe("TestHandle");
    expect(typeof sent.id).toBe("string");
    expect(typeof sent.ts).toBe("number");
    expect(mgr.getState().messages).toHaveLength(1);
    expect(mgr.getState().messages[0].text).toBe("hello world");
    mgr.destroy();
  });

  it("send blocks profanity and surfaces an error", async () => {
    const fake = makeFakePresence();
    const mgr = new ChatManager(fake.api, "Octopus");
    await mgr.init();
    const ok = mgr.send("oh shit");
    expect(ok).toBe(false);
    expect(fake.getLastSent()).toBeNull();
    expect(mgr.getState().sendError).toBeTruthy();
    expect(mgr.getState().messages).toHaveLength(0);
    mgr.destroy();
  });

  it("send silently no-ops on empty/whitespace", async () => {
    const fake = makeFakePresence();
    const mgr = new ChatManager(fake.api, "Octopus");
    await mgr.init();
    expect(mgr.send("")).toBe(false);
    expect(mgr.send("   ")).toBe(false);
    expect(mgr.send("\n\t")).toBe(false);
    expect(fake.getLastSent()).toBeNull();
    expect(mgr.getState().sendError).toBeFalsy();
    mgr.destroy();
  });

  it("send caps at 400 chars (truncates)", async () => {
    const fake = makeFakePresence();
    const mgr = new ChatManager(fake.api, "Octopus");
    await mgr.init();
    const long = "a".repeat(500);
    mgr.send(long);
    const sent = fake.getLastSent() as any;
    expect(sent.text.length).toBe(400);
    mgr.destroy();
  });

  it("send throttles to 1 per 500ms", async () => {
    const fake = makeFakePresence();
    const mgr = new ChatManager(fake.api, "Octopus");
    await mgr.init();
    expect(mgr.send("one")).toBe(true);
    expect(mgr.send("two")).toBe(false);
    vi.advanceTimersByTime(500);
    expect(mgr.send("three")).toBe(true);
    mgr.destroy();
  });

  it("receives peer messages via onPresenceChange and dedupes by id", async () => {
    const fake = makeFakePresence();
    const mgr = new ChatManager(fake.api, "Octopus");
    await mgr.init();
    const msg = { id: "m1", text: "hi", ts: 1000, name: "Peer One" };
    fake.emit(new Map([["peer-pk", peerView("peer-pk", "#4a9a8a", msg)]]));
    fake.emit(new Map([["peer-pk", peerView("peer-pk", "#4a9a8a", msg)]]));
    expect(mgr.getState().messages.filter((m) => m.id === "m1")).toHaveLength(1);
    mgr.destroy();
  });

  it("ignores the subscribe-time replay snapshot (live-session only)", async () => {
    // A late joiner subscribes and the presence API replays the current
    // snapshot — peers' latest messages. We must NOT seed the panel from it
    // (presence can't represent coherent history). Panel stays empty until a
    // fresh message arrives.
    const preExisting = new Map<string, PresenceView>([
      ["peer-a", peerView("peer-a", "#4a9a8a", { id: "old-a", text: "earlier", ts: 1, name: "A" })],
      ["peer-b", peerView("peer-b", "#d4b85c", { id: "old-b", text: "also earlier", ts: 2, name: "B" })],
    ]);
    const fake = makeFakePresence(preExisting);
    const mgr = new ChatManager(fake.api, "Octopus");
    await mgr.init();
    // Nothing from the replay should be in the panel.
    expect(mgr.getState().messages).toHaveLength(0);
    expect(mgr.getState().unread).toBe(false);

    // A genuinely new message after we joined DOES appear.
    fake.emit(
      new Map([
        ["peer-a", peerView("peer-a", "#4a9a8a", { id: "new-a", text: "live now", ts: 3, name: "A" })],
      ]),
    );
    expect(mgr.getState().messages).toHaveLength(1);
    expect(mgr.getState().messages[0].text).toBe("live now");

    // And a peer re-broadcasting one of the pre-existing (already-seen) ids
    // is NOT re-appended.
    fake.emit(
      new Map([
        ["peer-a", peerView("peer-a", "#4a9a8a", { id: "old-a", text: "earlier", ts: 1, name: "A" })],
      ]),
    );
    expect(mgr.getState().messages).toHaveLength(1);
    mgr.destroy();
  });

  it("sets unread when a peer message arrives and panel is closed", async () => {
    const fake = makeFakePresence();
    const mgr = new ChatManager(fake.api, "Octopus");
    await mgr.init();
    expect(mgr.getState().isOpen).toBe(false);
    fake.emit(
      new Map([
        [
          "peer-pk",
          peerView("peer-pk", "#4a9a8a", { id: "m1", text: "hi", ts: 1, name: "P" }),
        ],
      ]),
    );
    expect(mgr.getState().unread).toBe(true);
    mgr.toggle();
    expect(mgr.getState().isOpen).toBe(true);
    expect(mgr.getState().unread).toBe(false);
    mgr.destroy();
  });

  it("ring-buffer caps total messages at 50", async () => {
    const fake = makeFakePresence();
    const mgr = new ChatManager(fake.api, "Octopus");
    await mgr.init();
    for (let i = 0; i < 60; i++) {
      fake.emit(
        new Map([
          [
            `peer-${i}`,
            peerView(`peer-${i}`, "#aaa", { id: `m${i}`, text: "x", ts: i, name: "P" }),
          ],
        ]),
      );
    }
    expect(mgr.getState().messages.length).toBe(50);
    expect(mgr.getState().messages[0].id).toBe("m10");
    expect(mgr.getState().messages[49].id).toBe("m59");
    mgr.destroy();
  });

  it("subscribe notifies on state changes and unsubscribe stops notifications", async () => {
    const fake = makeFakePresence();
    const mgr = new ChatManager(fake.api, "Octopus");
    await mgr.init();
    const seen: number[] = [];
    const unsub = mgr.subscribe(() => seen.push(mgr.getState().messages.length));
    mgr.send("a");
    expect(seen.at(-1)).toBe(1);
    unsub();
    mgr.send("b");
    vi.advanceTimersByTime(1000);
    mgr.send("c");
    expect(seen.at(-1)).toBe(1);
    mgr.destroy();
  });

  it("reroll updates handle and notifies", async () => {
    const fake = makeFakePresence();
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ title: "Rerolled Name" }),
    } as Response) as typeof fetch;
    const mgr = new ChatManager(fake.api, "Octopus");
    await mgr.init();
    await mgr.reroll();
    expect(mgr.getState().handle).toBe("Rerolled Name");
    mgr.destroy();
  });
});
