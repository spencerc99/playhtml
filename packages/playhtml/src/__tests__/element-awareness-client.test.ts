// ABOUTME: Verifies ElementAwarenessClient publishes bounded channels and
// ABOUTME: rebuilds per-element awareness maps from page-scoped presence peers.

import { describe, expect, it, vi } from "vitest";
import { MAX_PRESENCE_VALUE_BYTES } from "@playhtml/common";
import { RealtimePresenceTransport } from "../presence-transport";
import {
  ElementAwarenessClient,
  MAX_ELEMENT_PRESENCE_SHARDS,
  type ElementAwarenessMap,
} from "../element-awareness";

// Publishes are coalesced across a microtask, so drain it before asserting on
// what reached the socket. Local emits stay synchronous, so emitted-map
// assertions do not need this.
function flushPublish(): Promise<void> {
  return Promise.resolve();
}

class FakeSocket {
  sent: string[] = [];
  closed = false;
  readyState = 1;
  listeners = new Map<string, Set<(event: MessageEvent) => void>>();
  send(message: string): void {
    this.sent.push(message);
  }
  close(): void {
    this.closed = true;
  }
  addEventListener(event: string, callback: (event: MessageEvent) => void): void {
    const callbacks = this.listeners.get(event) ?? new Set();
    callbacks.add(callback);
    this.listeners.set(event, callbacks);
  }
  removeEventListener(event: string, callback: (event: MessageEvent) => void): void {
    this.listeners.get(event)?.delete(callback);
  }
  receive(data: unknown): void {
    const event = { data: JSON.stringify(data) } as MessageEvent;
    for (const listener of this.listeners.get("message") ?? []) {
      listener(event);
    }
  }
}

const IDENTITY = {
  publicKey: "pk_local",
  playerStyle: { colorPalette: ["red"] },
};

function jsonByteLength(value: unknown): number {
  const json = JSON.stringify(value);
  if (json === undefined) return Infinity;
  return new TextEncoder().encode(json).byteLength;
}

function createClient() {
  const socket = new FakeSocket();
  const transport = new RealtimePresenceTransport({
    host: "example.com",
    room: "/page",
    socketFactory: () => socket as any,
  });
  const emitted: ElementAwarenessMap[] = [];
  const client = new ElementAwarenessClient({
    transport,
    getIdentity: () => IDENTITY,
    getPage: () => "/page",
    onAwareness: (map) => emitted.push(map),
  });
  const parsedSent = () => socket.sent.map((m) => JSON.parse(m));
  return { socket, transport, client, emitted, parsedSent };
}

describe("ElementAwarenessClient", () => {
  it("joins with identity on construction", () => {
    const { parsedSent } = createClient();
    expect(parsedSent()[0]).toMatchObject({
      type: "presence-join",
      identity: { publicKey: "pk_local" },
      page: "/page",
    });
  });

  it("publishes element awareness in a bounded shard and emits locally", async () => {
    const { client, parsedSent, emitted } = createClient();
    client.setLocalAwareness("can-play", "card", { active: true });
    // Local emit is synchronous.
    const entry = emitted.at(-1)!.get("can-play:card")!;
    expect(entry.array).toEqual([{ active: true }]);
    expect(entry.byStableId.get("pk_local")).toEqual({ active: true });
    expect(client.getLocalAwareness("can-play", "card")).toEqual({ active: true });
    // Publish is coalesced onto a microtask.
    await flushPublish();
    expect(parsedSent().at(-1)).toEqual({
      type: "presence-update",
      channel: "element:shard:0",
      value: { v: 1, entries: [["can-play", "card", { active: true }]] },
    });
  });

  it("skips publish when the value is reference-equal", async () => {
    const { client, socket } = createClient();
    const value = { active: true };
    client.setLocalAwareness("can-play", "card", value);
    await flushPublish();
    const sentCount = socket.sent.length;
    client.setLocalAwareness("can-play", "card", value);
    await flushPublish();
    expect(socket.sent.length).toBe(sentCount);
  });

  it("coalesces multiple writes in one tick into a single publish", async () => {
    const { client, parsedSent } = createClient();
    client.setLocalAwareness("can-play", "a", { n: 1 });
    client.setLocalAwareness("can-play", "b", { n: 2 });
    client.setLocalAwareness("can-play", "c", { n: 3 });
    await flushPublish();
    const updates = parsedSent().filter(
      (message) => message.type === "presence-update",
    );
    expect(updates).toHaveLength(1);
    expect(updates[0].value.entries).toHaveLength(3);
  });

  it("removal republishes the shrunk map, and clears the channel when empty", async () => {
    const { client, parsedSent } = createClient();
    client.setLocalAwareness("can-play", "a", { n: 1 });
    client.setLocalAwareness("can-play", "b", { n: 2 });
    client.removeLocalAwareness("can-play", "a");
    await flushPublish();
    expect(parsedSent().at(-1)).toEqual({
      type: "presence-update",
      channel: "element:shard:0",
      value: { v: 1, entries: [["can-play", "b", { n: 2 }]] },
    });
    client.removeLocalAwareness("can-play", "b");
    await flushPublish();
    expect(parsedSent().at(-1)).toEqual({
      type: "presence-clear",
      channel: "element:shard:0",
    });
  });

  it("rebuilds remote shard awareness keyed by identity publicKey", () => {
    const { socket, emitted } = createClient();
    socket.receive({
      type: "presence-sync",
      peers: {
        "conn-2": {
          identity: { publicKey: "pk_remote", playerStyle: { colorPalette: ["blue"] } },
          "element:shard:0": {
            v: 1,
            entries: [["can-play", "card", { active: true }]],
          },
        },
      },
    });
    const entry = emitted.at(-1)!.get("can-play:card")!;
    expect(entry.array).toEqual([{ active: true }]);
    expect(entry.byStableId.get("pk_remote")).toEqual({ active: true });
  });

  it("rebuilds remote legacy tag-map awareness", () => {
    const { socket, emitted } = createClient();
    socket.receive({
      type: "presence-sync",
      peers: {
        "conn-2": {
          identity: { publicKey: "pk_remote", playerStyle: { colorPalette: ["blue"] } },
          "element:can-play": { card: { active: true } },
        },
      },
    });
    const entry = emitted.at(-1)!.get("can-play:card")!;
    expect(entry.array).toEqual([{ active: true }]);
    expect(entry.byStableId.get("pk_remote")).toEqual({ active: true });
  });

  it("falls back to connection id when a peer has no identity", () => {
    const { socket, emitted } = createClient();
    socket.receive({
      type: "presence-sync",
      peers: {
        "conn-9": { "element:can-play": { card: { hover: true } } },
      },
    });
    expect(emitted.at(-1)!.get("can-play:card")!.byStableId.get("conn-9")).toEqual({
      hover: true,
    });
  });

  it("ignores its own server echo, keeping the local map canonical", () => {
    const { client, socket, emitted } = createClient();
    client.setLocalAwareness("can-play", "card", { active: true });
    socket.receive({
      type: "presence-changes",
      updates: {
        "conn-self": {
          identity: IDENTITY,
          "element:shard:0": {
            v: 1,
            entries: [["can-play", "card", { active: true }]],
          },
        },
      },
      removes: {},
    });
    const entry = emitted.at(-1)!.get("can-play:card")!;
    expect(entry.array).toEqual([{ active: true }]);
    expect(entry.byStableId.size).toBe(1);
  });

  it("removes a peer's awareness when its channels are removed on disconnect", () => {
    const { socket, emitted } = createClient();
    socket.receive({
      type: "presence-sync",
      peers: {
        "conn-2": {
          identity: { publicKey: "pk_remote", playerStyle: { colorPalette: ["blue"] } },
          "element:shard:0": {
            v: 1,
            entries: [["can-play", "card", { active: true }]],
          },
        },
      },
    });
    socket.receive({
      type: "presence-changes",
      updates: {},
      removes: { "conn-2": ["identity", "element:shard:0"] },
    });
    expect(emitted.at(-1)!.has("can-play:card")).toBe(false);
  });

  it("does not recompute for cursor-only changes on a shared socket", () => {
    const { socket, emitted } = createClient();
    const emittedCount = emitted.length;
    socket.receive({
      type: "presence-changes",
      updates: {
        "conn-2": { cursor: { cursor: { x: 1, y: 2, pointer: "mouse" }, at: 1 } },
      },
      removes: {},
    });
    expect(emitted.length).toBe(emittedCount);
  });

  it("survives oversized publish values without throwing", async () => {
    const { client } = createClient();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const huge = { blob: "x".repeat(5000) };
    expect(() => client.setLocalAwareness("can-play", "card", huge)).not.toThrow();
    await flushPublish();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("clears a previously published shard when the replacement value is oversized", async () => {
    const { client, parsedSent } = createClient();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    client.setLocalAwareness("can-play", "card", { active: true });
    await flushPublish();
    client.setLocalAwareness("can-play", "card", { blob: "x".repeat(5000) });
    await flushPublish();

    expect(warn).toHaveBeenCalled();
    expect(parsedSent().at(-1)).toEqual({
      type: "presence-clear",
      channel: "element:shard:0",
    });
    warn.mockRestore();
  });

  it("keeps high-count element awareness publishes below the presence value limit", async () => {
    const { client, parsedSent } = createClient();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    for (let i = 0; i < 300; i += 1) {
      client.setLocalAwareness("can-mirror", `tile-${i}`, {
        hover: false,
        focus: false,
      });
    }
    await flushPublish();

    const updates = parsedSent().filter(
      (message) =>
        message.type === "presence-update" &&
        message.channel.startsWith("element:"),
    );
    expect(updates.length).toBeGreaterThan(0);
    for (const update of updates) {
      expect(jsonByteLength(update.value)).toBeLessThanOrEqual(
        MAX_PRESENCE_VALUE_BYTES,
      );
    }
    expect(JSON.stringify(updates)).toContain("tile-299");
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
    warn.mockRestore();
    error.mockRestore();
  });

  it("coalesces N element inits into one bounded burst of channel updates", async () => {
    const { client, parsedSent } = createClient();
    for (let i = 0; i < 100; i += 1) {
      client.setLocalAwareness("can-mirror", `tile-${i}`, { hover: false });
    }
    await flushPublish();
    const updates = parsedSent().filter(
      (message) =>
        message.type === "presence-update" &&
        message.channel.startsWith("element:"),
    );
    // 100 inits coalesce into one publish; the shard count is well under the
    // server's 45-interactive-updates/sec budget.
    expect(updates.length).toBeLessThan(45);
    expect(updates.length).toBeLessThanOrEqual(MAX_ELEMENT_PRESENCE_SHARDS);
    // And every element made it into the published state.
    const published = JSON.stringify(updates);
    expect(published).toContain("tile-0");
    expect(published).toContain("tile-99");
  });

  it("caps shards and drops overflow with one error, keeping under-budget shards", async () => {
    const { client, parsedSent } = createClient();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    // Each entry ~1KB of payload; ~4 per 4KB shard, so >32 entries overflow the
    // 8-shard budget. Use distinct tags so the dropped-tags log is meaningful.
    const bigValue = { blob: "x".repeat(1000) };
    for (let i = 0; i < 60; i += 1) {
      client.setLocalAwareness(`tag-${String(i).padStart(3, "0")}`, "el", {
        ...bigValue,
      });
    }
    await flushPublish();

    const updates = parsedSent().filter(
      (message) =>
        message.type === "presence-update" &&
        message.channel.startsWith("element:shard:"),
    );
    // Never more than the shard budget.
    expect(updates.length).toBeLessThanOrEqual(MAX_ELEMENT_PRESENCE_SHARDS);
    // The first (under-budget) shards still sync.
    expect(JSON.stringify(updates)).toContain("tag-000");
    // Exactly one loud error naming the limit.
    expect(error).toHaveBeenCalledTimes(1);
    expect(String(error.mock.calls[0][0])).toContain(
      String(MAX_ELEMENT_PRESENCE_SHARDS),
    );
    error.mockRestore();
  });

  it("re-publishes the latest snapshot after a burst settles (resilience)", async () => {
    vi.useFakeTimers();
    try {
      const { client, parsedSent } = createClient();
      client.setLocalAwareness("can-play", "card", { active: true });
      await Promise.resolve(); // drain the coalescing microtask
      const afterInitial = parsedSent().filter(
        (m) => m.type === "presence-update",
      ).length;
      expect(afterInitial).toBe(1);

      // A trailing re-publish re-sends whatever the server may have dropped.
      await vi.advanceTimersByTimeAsync(500);
      const afterTrailing = parsedSent().filter(
        (m) => m.type === "presence-update",
      ).length;
      expect(afterTrailing).toBe(2);
      expect(parsedSent().at(-1)).toEqual({
        type: "presence-update",
        channel: "element:shard:0",
        value: { v: 1, entries: [["can-play", "card", { active: true }]] },
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("destroy cancels a pending trailing re-publish", async () => {
    vi.useFakeTimers();
    try {
      const { client, parsedSent } = createClient();
      client.setLocalAwareness("can-play", "card", { active: true });
      await Promise.resolve();
      const before = parsedSent().length;
      client.destroy();
      await vi.advanceTimersByTimeAsync(1000);
      expect(parsedSent().length).toBe(before);
    } finally {
      vi.useRealTimers();
    }
  });

  it("destroy unsubscribes but does not close the shared transport", () => {
    const { client, socket, emitted } = createClient();
    client.destroy();
    const count = emitted.length;
    socket.receive({
      type: "presence-sync",
      peers: {},
    });
    expect(emitted.length).toBe(count);
    expect(socket.closed).toBe(false);
  });
});
