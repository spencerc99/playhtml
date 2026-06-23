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
  listeners = new Map<string, Set<(event: MessageEvent) => void>>();

  send(message: string): void {
    this.sent.push(message);
  }

  close(): void {
    this.closed = true;
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
