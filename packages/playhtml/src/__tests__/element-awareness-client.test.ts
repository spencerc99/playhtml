// ABOUTME: Verifies ElementAwarenessClient publishes tag channels and rebuilds
// ABOUTME: per-element awareness maps from page-scoped presence peers.

import { describe, expect, it, vi } from "vitest";
import { RealtimePresenceTransport } from "../presence-transport";
import {
  ElementAwarenessClient,
  type ElementAwarenessMap,
} from "../element-awareness";

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

  it("publishes the whole tag map on element:<tag> and emits locally", () => {
    const { client, parsedSent, emitted } = createClient();
    client.setLocalAwareness("can-play", "card", { active: true });
    expect(parsedSent().at(-1)).toEqual({
      type: "presence-update",
      channel: "element:can-play",
      value: { card: { active: true } },
    });
    const entry = emitted.at(-1)!.get("can-play:card")!;
    expect(entry.array).toEqual([{ active: true }]);
    expect(entry.byStableId.get("pk_local")).toEqual({ active: true });
    expect(client.getLocalAwareness("can-play", "card")).toEqual({ active: true });
  });

  it("skips publish when the value is reference-equal", () => {
    const { client, socket } = createClient();
    const value = { active: true };
    client.setLocalAwareness("can-play", "card", value);
    const sentCount = socket.sent.length;
    client.setLocalAwareness("can-play", "card", value);
    expect(socket.sent.length).toBe(sentCount);
  });

  it("removal republishes the shrunk map, and clears the channel when empty", () => {
    const { client, parsedSent } = createClient();
    client.setLocalAwareness("can-play", "a", { n: 1 });
    client.setLocalAwareness("can-play", "b", { n: 2 });
    client.removeLocalAwareness("can-play", "a");
    expect(parsedSent().at(-1)).toEqual({
      type: "presence-update",
      channel: "element:can-play",
      value: { b: { n: 2 } },
    });
    client.removeLocalAwareness("can-play", "b");
    expect(parsedSent().at(-1)).toEqual({
      type: "presence-clear",
      channel: "element:can-play",
    });
  });

  it("rebuilds remote awareness keyed by identity publicKey", () => {
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
          "element:can-play": { card: { active: true } },
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
          "element:can-play": { card: { active: true } },
        },
      },
    });
    socket.receive({
      type: "presence-changes",
      updates: {},
      removes: { "conn-2": ["identity", "element:can-play"] },
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

  it("survives oversized publish values without throwing", () => {
    const { client } = createClient();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const huge = { blob: "x".repeat(5000) };
    expect(() => client.setLocalAwareness("can-play", "card", huge)).not.toThrow();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
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
