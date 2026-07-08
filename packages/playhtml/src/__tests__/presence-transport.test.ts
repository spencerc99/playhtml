// ABOUTME: Verifies the realtime presence transport sends and receives protocol messages.
// ABOUTME: Uses a fake socket so transport behavior is tested without network I/O.

import { describe, expect, it } from "vitest";
import {
  RealtimePresenceTransport,
  type PresenceSocketFactory,
} from "../presence-transport";

class FakeSocket {
  sent: string[] = [];
  closed = false;
  readyState = WebSocket.CONNECTING;
  listeners = new Map<string, Set<(event: MessageEvent) => void>>();

  send(message: string): boolean {
    if (this.readyState !== WebSocket.OPEN) return false;
    this.sent.push(message);
    return true;
  }

  close(): void {
    this.closed = true;
    this.readyState = WebSocket.CLOSED;
  }

  addEventListener(event: string, callback: (event: MessageEvent) => void): void {
    const listeners = this.listeners.get(event) ?? new Set();
    listeners.add(callback);
    this.listeners.set(event, listeners);
  }

  removeEventListener(
    event: string,
    callback: (event: MessageEvent) => void,
  ): void {
    this.listeners.get(event)?.delete(callback);
  }

  receive(data: unknown): void {
    const event = { data: JSON.stringify(data) } as MessageEvent;
    for (const listener of this.listeners.get("message") ?? []) {
      listener(event);
    }
  }

  open(): void {
    this.readyState = WebSocket.OPEN;
    const event = {} as MessageEvent;
    for (const listener of this.listeners.get("open") ?? []) {
      listener(event);
    }
  }

  disconnect(): void {
    this.readyState = WebSocket.CLOSED;
    const event = {} as MessageEvent;
    for (const listener of this.listeners.get("close") ?? []) {
      listener(event);
    }
  }
}

describe("RealtimePresenceTransport", () => {
  it("connects to the generic presence party", () => {
    let createdOptions: Parameters<PresenceSocketFactory>[0] | null = null;
    const socket = new FakeSocket();

    new RealtimePresenceTransport({
      host: "example.com",
      room: "room-1",
      socketFactory: (options) => {
        createdOptions = options;
        return socket;
      },
    });

    expect(createdOptions).toMatchObject({
      host: "example.com",
      room: "room-1",
      party: "presence",
    });
  });

  it("sends validated join and update messages", () => {
    const socket = new FakeSocket();
    const transport = new RealtimePresenceTransport({
      host: "example.com",
      room: "room-1",
      socketFactory: () => socket,
    });

    socket.open();

    transport.join({
      identity: {
        publicKey: "pk_1",
        playerStyle: { colorPalette: ["red"] },
      },
      page: "/week/1",
    });
    transport.update("cursor", {
      cursor: { x: 1, y: 2, pointer: "mouse" },
      at: 100,
    });

    expect(socket.sent.map((message) => JSON.parse(message))).toEqual([
      {
        type: "presence-join",
        identity: {
          publicKey: "pk_1",
          playerStyle: { colorPalette: ["red"] },
        },
        page: "/week/1",
      },
      {
        type: "presence-update",
        channel: "cursor",
        value: {
          cursor: { x: 1, y: 2, pointer: "mouse" },
          at: 100,
        },
      },
    ]);
  });

  it("rejects private fields on identity updates", () => {
    const socket = new FakeSocket();
    const transport = new RealtimePresenceTransport({
      host: "example.com",
      room: "room-1",
      socketFactory: () => socket,
    });

    socket.open();

    expect(() =>
      transport.update("identity", {
        publicKey: "pk_1",
        privateKey: { kty: "EC", d: "private" },
        playerStyle: { colorPalette: ["red"] },
      }),
    ).toThrow("identity must only include public presence fields");
    expect(socket.sent).toEqual([]);
  });

  it("coalesces state while closed and flushes the latest values on open", () => {
    const socket = new FakeSocket();
    const transport = new RealtimePresenceTransport({
      host: "example.com",
      room: "room-1",
      socketFactory: () => socket,
    });

    transport.join({
      identity: {
        publicKey: "pk_1",
        playerStyle: { colorPalette: ["red"] },
      },
      page: "/week/1",
    });
    transport.update("cursor", {
      cursor: { x: 1, y: 2, pointer: "mouse" },
      at: 100,
    });
    transport.update("cursor", {
      cursor: { x: 10, y: 20, pointer: "mouse" },
      at: 116,
    });

    expect(socket.sent).toEqual([]);

    socket.open();

    expect(socket.sent.map((message) => JSON.parse(message))).toEqual([
      {
        type: "presence-join",
        identity: {
          publicKey: "pk_1",
          playerStyle: { colorPalette: ["red"] },
        },
        page: "/week/1",
      },
      {
        type: "presence-update",
        channel: "cursor",
        value: {
          cursor: { x: 10, y: 20, pointer: "mouse" },
          at: 116,
        },
      },
    ]);
  });

  it("replays join and latest state after reconnect", () => {
    const socket = new FakeSocket();
    const transport = new RealtimePresenceTransport({
      host: "example.com",
      room: "room-1",
      socketFactory: () => socket,
    });

    transport.join({
      identity: {
        publicKey: "pk_1",
        playerStyle: { colorPalette: ["red"] },
      },
      page: "/week/1",
    });
    socket.open();
    socket.sent = [];
    socket.disconnect();
    socket.readyState = WebSocket.CONNECTING;

    transport.update("cursor", {
      cursor: { x: 20, y: 30, pointer: "mouse" },
      at: 200,
    });
    socket.open();

    expect(socket.sent.map((message) => JSON.parse(message))).toEqual([
      {
        type: "presence-join",
        identity: {
          publicKey: "pk_1",
          playerStyle: { colorPalette: ["red"] },
        },
        page: "/week/1",
      },
      {
        type: "presence-update",
        channel: "cursor",
        value: {
          cursor: { x: 20, y: 30, pointer: "mouse" },
          at: 200,
        },
      },
    ]);
  });

  it("notifies listeners of server sync and change messages", () => {
    const socket = new FakeSocket();
    const transport = new RealtimePresenceTransport({
      host: "example.com",
      room: "room-1",
      socketFactory: () => socket,
    });
    const received: unknown[] = [];
    transport.subscribe((message) => received.push(message));

    socket.receive({ type: "presence-sync", peers: {} });
    socket.receive({ type: "presence-changes", updates: {}, removes: {} });

    expect(received).toEqual([
      { type: "presence-sync", peers: {} },
      { type: "presence-changes", updates: {}, removes: {} },
    ]);
  });

  it("ignores malformed nested server change messages", () => {
    const socket = new FakeSocket();
    const transport = new RealtimePresenceTransport({
      host: "example.com",
      room: "room-1",
      socketFactory: () => socket,
    });
    const received: unknown[] = [];
    transport.subscribe((message) => received.push(message));

    socket.receive({
      type: "presence-changes",
      updates: {
        "conn-1": "not-channels",
      },
      removes: {
        "conn-2": "not-channel-list",
      },
    });

    expect(received).toEqual([]);
  });

  it("closes the socket on destroy", () => {
    const socket = new FakeSocket();
    const transport = new RealtimePresenceTransport({
      host: "example.com",
      room: "room-1",
      socketFactory: () => socket,
    });

    transport.destroy();

    expect(socket.closed).toBe(true);
  });
});
