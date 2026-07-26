// ABOUTME: Verifies PresenceClient publishes page presence over the transport
// ABOUTME: and rebuilds per-channel PresenceView maps from page-scoped peers.

import { describe, expect, it } from "vitest";
import type { PlayerIdentity, PresenceView } from "@playhtml/common";
import { RealtimePresenceTransport } from "../presence-transport";
import { PresenceClient } from "../presence-client";

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
  open(): void {
    this.readyState = 1;
    for (const listener of this.listeners.get("open") ?? []) {
      listener({} as MessageEvent);
    }
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

const IDENTITY: PlayerIdentity = {
  publicKey: "pk_local",
  playerStyle: { colorPalette: ["red"] },
} as PlayerIdentity;

function remoteIdentity(publicKey: string): PlayerIdentity {
  return {
    publicKey,
    playerStyle: { colorPalette: ["blue"] },
  } as PlayerIdentity;
}

function createClient(identity: PlayerIdentity = IDENTITY) {
  const socket = new FakeSocket();
  const transport = new RealtimePresenceTransport({
    host: "example.com",
    room: "/page",
    socketFactory: () => socket as any,
  });
  const client = new PresenceClient({
    transport,
    getIdentity: () => identity,
    getPage: () => "/page",
  });
  const parsedSent = () => socket.sent.map((m) => JSON.parse(m));
  return { socket, transport, client, parsedSent };
}

function selfOf(presences: Map<string, PresenceView>): PresenceView {
  return Array.from(presences.values()).find((p) => p.isMe)!;
}

describe("PresenceClient", () => {
  it("joins with identity on construction", () => {
    const { parsedSent } = createClient();
    expect(parsedSent()[0]).toMatchObject({
      type: "presence-join",
      identity: { publicKey: "pk_local" },
      page: "/page",
    });
  });

  it("publishes a namespaced channel and reflects it in self view", () => {
    const { client, parsedSent } = createClient();
    client.setMyPresence("status", { text: "online" });
    expect(parsedSent().at(-1)).toEqual({
      type: "presence-update",
      channel: "presence:status",
      value: { text: "online" },
    });
    const self = selfOf(client.getPresences());
    expect(self.isMe).toBe(true);
    expect((self as any).status).toEqual({ text: "online" });
  });

  it("clears a channel when set to null", () => {
    const { client, parsedSent } = createClient();
    client.setMyPresence("status", { text: "online" });
    client.setMyPresence("status", null);
    expect(parsedSent().at(-1)).toEqual({
      type: "presence-clear",
      channel: "presence:status",
    });
    const self = selfOf(client.getPresences());
    expect((self as any).status).toBeUndefined();
  });

  it("getPresences always includes self even before any peers sync", () => {
    const { client } = createClient();
    const presences = client.getPresences();
    expect(presences.size).toBe(1);
    expect(presences.get("pk_local")!.isMe).toBe(true);
  });

  it("rebuilds a remote peer's presence keyed by identity publicKey", () => {
    const { socket, client } = createClient();
    socket.receive({
      type: "presence-sync",
      peers: {
        "conn-2": {
          identity: remoteIdentity("pk_remote"),
          "presence:status": { text: "typing" },
        },
      },
    });
    const presences = client.getPresences();
    const remote = presences.get("pk_remote")!;
    expect(remote.isMe).toBe(false);
    expect(remote.playerIdentity!.publicKey).toBe("pk_remote");
    expect((remote as any).status).toEqual({ text: "typing" });
  });

  it("ignores its own server echo, keeping local channels canonical for self", () => {
    const { client, socket } = createClient();
    client.setMyPresence("status", { text: "here" });
    socket.receive({
      type: "presence-changes",
      updates: {
        "conn-self": {
          identity: IDENTITY,
          "presence:status": { text: "stale-echo" },
        },
      },
      removes: {},
    });
    const presences = client.getPresences();
    expect(presences.size).toBe(1);
    expect((selfOf(presences) as any).status).toEqual({ text: "here" });
  });

  it("collapses multiple tabs of a remote peer into one entry by publicKey", () => {
    const { socket, client } = createClient();
    socket.receive({
      type: "presence-sync",
      peers: {
        "conn-a": {
          identity: remoteIdentity("pk_remote"),
          "presence:status": { text: "tab-a" },
        },
        "conn-b": {
          identity: remoteIdentity("pk_remote"),
          "presence:status": { text: "tab-b" },
        },
      },
    });
    const presences = client.getPresences();
    const remoteEntries = Array.from(presences.values()).filter((p) => !p.isMe);
    expect(remoteEntries).toHaveLength(1);
  });

  it("notifies channel subscribers and replays the current snapshot", () => {
    const { socket, client } = createClient();
    socket.receive({
      type: "presence-sync",
      peers: {
        "conn-2": {
          identity: remoteIdentity("pk_remote"),
          "presence:status": { text: "here" },
        },
      },
    });
    const received: Array<Map<string, PresenceView>> = [];
    const unsub = client.onPresenceChange("status", (presences) => {
      received.push(presences);
    });
    // Late subscriber gets the current snapshot immediately.
    expect(received).toHaveLength(1);
    expect((received[0].get("pk_remote") as any).status).toEqual({ text: "here" });

    socket.receive({
      type: "presence-changes",
      updates: {
        "conn-2": { "presence:status": { text: "left" } },
      },
      removes: {},
    });
    expect(received).toHaveLength(2);
    expect((received[1].get("pk_remote") as any).status).toEqual({ text: "left" });
    unsub();
  });

  it("does not notify a subscriber for an unrelated channel change", () => {
    const { socket, client } = createClient();
    const received: unknown[] = [];
    const unsub = client.onPresenceChange("status", (p) => received.push(p));
    received.length = 0;
    socket.receive({
      type: "presence-changes",
      updates: {
        "conn-2": {
          identity: remoteIdentity("pk_remote"),
          "presence:mood": { emoji: "smile" },
        },
      },
      removes: {},
    });
    expect(received).toHaveLength(0);
    unsub();
  });

  it("removes a peer's presence when its channels are removed on disconnect", () => {
    const { socket, client } = createClient();
    socket.receive({
      type: "presence-sync",
      peers: {
        "conn-2": {
          identity: remoteIdentity("pk_remote"),
          "presence:status": { text: "here" },
        },
      },
    });
    expect(client.getPresences().has("pk_remote")).toBe(true);
    socket.receive({
      type: "presence-changes",
      updates: {},
      removes: { "conn-2": ["identity", "presence:status"] },
    });
    expect(client.getPresences().has("pk_remote")).toBe(false);
  });

  it("replays join and published channels to the server on reconnect", () => {
    const socket = new FakeSocket();
    const transport = new RealtimePresenceTransport({
      host: "example.com",
      room: "/page",
      socketFactory: () => socket as any,
    });
    const client = new PresenceClient({
      transport,
      getIdentity: () => IDENTITY,
      getPage: () => "/page",
    });
    client.setMyPresence("status", { text: "online" });
    socket.sent = [];
    // Simulate a reconnect: the transport flushes latestJoin + channelValues.
    socket.open();
    const parsed = socket.sent.map((m) => JSON.parse(m));
    expect(parsed).toContainEqual(
      expect.objectContaining({ type: "presence-join" }),
    );
    expect(parsed).toContainEqual({
      type: "presence-update",
      channel: "presence:status",
      value: { text: "online" },
    });
    client.destroy();
  });

  it("destroy unsubscribes but leaves the shared transport socket open", () => {
    const { client, socket } = createClient();
    const received: unknown[] = [];
    client.onPresenceChange("status", (p) => received.push(p));
    received.length = 0;
    client.destroy();
    socket.receive({
      type: "presence-changes",
      updates: {
        "conn-2": {
          identity: remoteIdentity("pk_remote"),
          "presence:status": { text: "after-destroy" },
        },
      },
      removes: {},
    });
    expect(received).toHaveLength(0);
    expect(socket.closed).toBe(false);
  });

  it("merges cursor presences from the shared snapshot", () => {
    const socket = new FakeSocket();
    const transport = new RealtimePresenceTransport({
      host: "example.com",
      room: "/page",
      socketFactory: () => socket as any,
    });
    const cursorPresences = new Map<string, any>([
      [
        "pk_remote",
        {
          cursor: { x: 10, y: 20, pointer: "mouse" },
          playerIdentity: remoteIdentity("pk_remote"),
        },
      ],
    ]);
    const client = new PresenceClient({
      transport,
      getIdentity: () => IDENTITY,
      getPage: () => "/page",
      getCursorPresences: () => cursorPresences,
    });
    const remote = client.getPresences().get("pk_remote")!;
    expect(remote.cursor).toEqual({ x: 10, y: 20, pointer: "mouse" });
    expect(remote.playerIdentity!.publicKey).toBe("pk_remote");
    expect(remote.isMe).toBe(false);
  });
});
