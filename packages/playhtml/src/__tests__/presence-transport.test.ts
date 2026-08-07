// ABOUTME: Verifies the realtime presence transport sends and receives protocol messages.
// ABOUTME: Uses a fake socket so transport behavior is tested without network I/O.

import { describe, expect, it, vi } from "vitest";
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

class PropertyMessageSocket extends FakeSocket {
  onmessage: ((event: MessageEvent) => void) | null = null;

  override receive(data: unknown): void {
    this.onmessage?.({ data: JSON.stringify(data) } as MessageEvent);
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

  it("does not retain rejected state while the socket is closed", () => {
    const socket = new FakeSocket();
    const transport = new RealtimePresenceTransport({
      host: "example.com",
      room: "room-1",
      socketFactory: () => socket,
    });

    expect(() =>
      transport.update("identity", {
        publicKey: "pk_1",
        privateKey: { kty: "EC", d: "private" },
        playerStyle: { colorPalette: ["red"] },
      }),
    ).toThrow("identity must only include public presence fields");

    expect(() => socket.open()).not.toThrow();
    expect(socket.sent).toEqual([]);
  });

  it("replays snapshots instead of caller-owned presence objects", () => {
    const socket = new FakeSocket();
    const transport = new RealtimePresenceTransport({
      host: "example.com",
      room: "room-1",
      socketFactory: () => socket,
    });
    const identity = {
      publicKey: "pk_1",
      playerStyle: { colorPalette: ["red"] },
    };
    const cursor = {
      cursor: { x: 1, y: 2, pointer: "mouse" },
      at: 100,
    };

    transport.join({ identity, page: "/week/1" });
    transport.update("cursor", cursor);

    Object.assign(identity, { privateKey: { kty: "EC", d: "private" } });
    cursor.cursor.x = 999;

    expect(() => socket.open()).not.toThrow();
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

  it("uses the socket message handler property when available", () => {
    const socket = new PropertyMessageSocket();
    const transport = new RealtimePresenceTransport({
      host: "example.com",
      room: "room-1",
      socketFactory: () => socket,
    });
    const received: unknown[] = [];
    transport.subscribe((message) => received.push(message));

    expect(socket.listeners.has("message")).toBe(false);
    socket.receive({ type: "presence-sync", peers: {} });

    expect(received).toEqual([{ type: "presence-sync", peers: {} }]);

    transport.destroy();
    expect(socket.onmessage).toBeNull();
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

  it("starts in the connecting state and flips to open", () => {
    const socket = new FakeSocket();
    const transport = new RealtimePresenceTransport({
      host: "example.com",
      room: "room-1",
      socketFactory: () => socket,
    });
    expect(transport.connectionState).toBe("connecting");
    socket.open();
    expect(transport.connectionState).toBe("open");
    transport.destroy();
  });

  it("flags unreachable after the grace window and logs exactly once", () => {
    vi.useFakeTimers();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const socket = new FakeSocket();
      const transport = new RealtimePresenceTransport({
        host: "example.com",
        room: "room-1",
        socketFactory: () => socket,
      });
      // Never opens.
      vi.advanceTimersByTime(20_000);
      expect(transport.connectionState).toBe("unreachable");
      const unreachableLogs = errorSpy.mock.calls.filter((c) =>
        String(c[0]).includes("unreachable"),
      );
      expect(unreachableLogs).toHaveLength(1);

      // Further failures do not re-log.
      socket.disconnect();
      socket.disconnect();
      const after = errorSpy.mock.calls.filter((c) =>
        String(c[0]).includes("unreachable"),
      );
      expect(after).toHaveLength(1);
      transport.destroy();
    } finally {
      vi.useRealTimers();
      errorSpy.mockRestore();
    }
  });

  it("flags unreachable after repeated failed reconnects before the grace window", () => {
    vi.useFakeTimers();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const socket = new FakeSocket();
      const transport = new RealtimePresenceTransport({
        host: "example.com",
        room: "room-1",
        socketFactory: () => socket,
      });
      socket.disconnect();
      socket.disconnect();
      expect(transport.connectionState).not.toBe("unreachable");
      socket.disconnect();
      expect(transport.connectionState).toBe("unreachable");
      transport.destroy();
    } finally {
      vi.useRealTimers();
      errorSpy.mockRestore();
    }
  });

  it("logs a base warning on presence-error and presence-rate, rate-limited", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const socket = new FakeSocket();
      const transport = new RealtimePresenceTransport({
        host: "example.com",
        room: "room-1",
        socketFactory: () => socket,
      });
      socket.open();

      socket.receive({ type: "presence-error", message: "bad value" });
      socket.receive({ type: "presence-rate", channel: "presence:x", hz: 20 });
      const first = warnSpy.mock.calls.length;
      expect(first).toBe(2);

      // Rapid repeats of the same event type are rate-limited (no new logs).
      socket.receive({ type: "presence-error", message: "bad again" });
      socket.receive({ type: "presence-error", message: "bad again" });
      expect(warnSpy.mock.calls.length).toBe(first);
      transport.destroy();
    } finally {
      warnSpy.mockRestore();
    }
  });
});
