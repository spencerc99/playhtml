// ABOUTME: Verifies PresenceClient publishes page presence over the transport
// ABOUTME: and rebuilds per-channel PresenceView maps from page-scoped peers.

import { describe, expect, it, vi } from "vitest";
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
    // Published value is wrapped in the {at, value} staleness envelope.
    expect(parsedSent().at(-1)).toMatchObject({
      type: "presence-update",
      channel: "presence:status",
      value: { value: { text: "online" }, at: expect.any(Number) },
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
    expect(parsed).toContainEqual(
      expect.objectContaining({
        type: "presence-update",
        channel: "presence:status",
        value: expect.objectContaining({ value: { text: "online" } }),
      }),
    );
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

  it("isolates a throwing subscriber so another channel's subscriber still fires", () => {
    const { socket, client } = createClient();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const good = vi.fn();
    client.onPresenceChange("status", () => {
      throw new Error("boom");
    });
    client.onPresenceChange("mood", good);
    good.mockClear();

    expect(() =>
      socket.receive({
        type: "presence-changes",
        updates: {
          "conn-2": {
            identity: remoteIdentity("pk_remote"),
            "presence:status": { t: 1 },
            "presence:mood": { emoji: "smile" },
          },
        },
        removes: {},
      }),
    ).not.toThrow();
    // The mood subscriber still fired even though the status subscriber threw.
    expect(good).toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("retries delivery after a throwing subscriber recovers (fingerprint not eaten)", () => {
    const { socket, client } = createClient();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    let shouldThrow = true;
    const received: unknown[] = [];
    client.onPresenceChange("status", (p) => {
      if (shouldThrow) throw new Error("boom");
      received.push(p);
    });
    received.length = 0;

    // First delivery throws; the fingerprint must NOT be committed.
    socket.receive({
      type: "presence-changes",
      updates: {
        "conn-2": {
          identity: remoteIdentity("pk_remote"),
          "presence:status": { t: 1 },
        },
      },
      removes: {},
    });
    expect(received).toHaveLength(0);

    // The subscriber recovers; a subsequent change re-delivers the state.
    shouldThrow = false;
    socket.receive({
      type: "presence-changes",
      updates: { "conn-2": { "presence:status": { t: 2 } } },
      removes: {},
    });
    expect(received.length).toBeGreaterThan(0);
    errorSpy.mockRestore();
  });

  it("re-publishes the latest channel values only after the rate window (rate-drop recovery)", async () => {
    vi.useFakeTimers();
    try {
      const { client, parsedSent } = createClient();
      client.setMyPresence("status", { text: "online" });
      const countUpdates = () =>
        parsedSent().filter((m) => m.type === "presence-update").length;
      expect(countUpdates()).toBe(1);

      // The trailing re-publish must NOT land inside the server's 1,000ms rate
      // window (it would be dropped too).
      await vi.advanceTimersByTimeAsync(500);
      expect(countUpdates()).toBe(1);

      // It fires once the window has passed.
      await vi.advanceTimersByTimeAsync(700);
      expect(countUpdates()).toBe(2);
      expect(parsedSent().at(-1)).toMatchObject({
        type: "presence-update",
        channel: "presence:status",
        value: { value: { text: "online" } },
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("destroy cancels a pending trailing re-publish", async () => {
    vi.useFakeTimers();
    try {
      const { client, parsedSent } = createClient();
      client.setMyPresence("status", { text: "online" });
      const before = parsedSent().length;
      client.destroy();
      await vi.advanceTimersByTimeAsync(1200);
      expect(parsedSent().length).toBe(before);
    } finally {
      vi.useRealTimers();
    }
  });

  it("converges after a burst that exceeds the server's per-window budget", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    try {
      // Socket that models the server: accepts up to 20 event-bucket messages
      // per fixed 1,000ms window, drops the rest, and records the last value it
      // actually committed per channel (the "server state" peers would see).
      const budget = 20;
      const windowMs = 1000;
      let windowStart = 0;
      let count = 0;
      const committed = new Map<string, unknown>();
      const socket = new FakeSocket();
      const originalSend = socket.send.bind(socket);
      socket.send = (message: string) => {
        originalSend(message);
        const now = Date.now();
        if (now - windowStart >= windowMs) {
          windowStart = now;
          count = 0;
        }
        const parsed = JSON.parse(message);
        if (parsed.type !== "presence-update" && parsed.type !== "presence-clear") {
          return; // join etc. not on the event budget for this model
        }
        if (count >= budget) return; // dropped
        count += 1;
        // Unwrap the {at, value} staleness envelope to the user payload.
        if (parsed.type === "presence-update") {
          committed.set(parsed.channel, parsed.value.value);
        } else committed.delete(parsed.channel);
      };
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

      // 25 rapid updates to the same channel — most are dropped in this window.
      for (let i = 0; i < 25; i += 1) {
        client.setMyPresence("status", { n: i });
      }
      // The final value did NOT make it through the saturated window.
      expect(committed.get("presence:status")).not.toEqual({ n: 24 });

      // After the window passes, the trailing re-publish delivers the latest.
      await vi.advanceTimersByTimeAsync(1200);
      expect(committed.get("presence:status")).toEqual({ n: 24 });
    } finally {
      vi.useRealTimers();
    }
  });

  it("recovers a dropped clear on the trailing re-publish", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    try {
      // Server model where the NEXT send after saturation is dropped, so the
      // clear itself is lost in-window.
      const committed = new Map<string, unknown>();
      let dropNext = false;
      const socket = new FakeSocket();
      const originalSend = socket.send.bind(socket);
      socket.send = (message: string) => {
        originalSend(message);
        const parsed = JSON.parse(message);
        if (parsed.type === "presence-update") {
          committed.set(parsed.channel, parsed.value.value);
        } else if (parsed.type === "presence-clear") {
          if (dropNext) {
            dropNext = false;
            return; // the clear is dropped
          }
          committed.delete(parsed.channel);
        }
      };
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
      expect(committed.get("presence:status")).toEqual({ text: "online" });

      // Clear it, but the server drops this clear.
      dropNext = true;
      client.setMyPresence("status", null);
      expect(committed.has("presence:status")).toBe(true); // still present!

      // The trailing re-publish re-issues the clear, so peers eventually see it.
      await vi.advanceTimersByTimeAsync(1200);
      expect(committed.has("presence:status")).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects writing a reserved presence field name", () => {
    const { client } = createClient();
    for (const reserved of ["playerIdentity", "cursor", "isMe"]) {
      expect(() => client.setMyPresence(reserved, { spoof: true })).toThrow(
        /reserved presence field/,
      );
    }
  });

  it("ignores a hostile peer's spoofed reserved fields when folding", () => {
    const { socket, client } = createClient();
    socket.receive({
      type: "presence-sync",
      peers: {
        "conn-evil": {
          identity: remoteIdentity("pk_evil"),
          // A malicious peer bypasses the client and publishes reserved names.
          "presence:playerIdentity": { publicKey: "pk_victim" },
          "presence:isMe": true,
          "presence:cursor": { x: 1, y: 2, pointer: "mouse" },
          "presence:status": { text: "legit" },
        },
      },
    });
    const evil = client.getPresences().get("pk_evil")!;
    // The trusted fields come from the validated identity channel, not the spoof.
    expect(evil.playerIdentity!.publicKey).toBe("pk_evil");
    expect(evil.isMe).toBe(false);
    expect(evil.cursor).toBeNull();
    // Non-reserved custom channels still fold normally.
    expect((evil as any).status).toEqual({ text: "legit" });
  });

  it("drops a ghost peer's presence after the staleness window", () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const { socket, client } = createClient();
      socket.receive({
        type: "presence-sync",
        peers: {
          "conn-ghost": {
            identity: remoteIdentity("pk_ghost"),
            "presence:status": { at: Date.now(), value: { text: "here" } },
          },
        },
      });
      expect(client.getPresences().has("pk_ghost")).toBe(true);

      // No further message from the ghost; the sweep drops the stale channel,
      // and with only an unstamped identity left the peer row is pruned.
      vi.advanceTimersByTime(31_000);
      const status = (client.getPresences().get("pk_ghost") as any)?.status;
      expect(status).toBeUndefined();
      expect(error).toHaveBeenCalledWith(
        expect.stringContaining("presence transport unreachable"),
      );
    } finally {
      error.mockRestore();
      vi.useRealTimers();
    }
  });

  it("does not re-fire a subscriber when only a peer's timestamp refreshes", () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    try {
      const { socket, client } = createClient();
      const received: unknown[] = [];
      client.onPresenceChange("status", (p) => received.push(p));
      const statusAt = (at: number) => ({
        type: "presence-sync" as const,
        peers: {
          "conn-2": {
            identity: remoteIdentity("pk_remote"),
            "presence:status": { at, value: { text: "here" } },
          },
        },
      });
      socket.receive(statusAt(1000));
      received.length = 0;
      // Same payload, newer `at` (keepalive re-stamp): must not re-fire.
      socket.receive(statusAt(2000));
      expect(received).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps a quiet-but-connected self alive via the keepalive re-stamp", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    try {
      const { client, parsedSent } = createClient();
      client.setMyPresence("status", { text: "idle" });
      const updatesAfterInitial = parsedSent().filter(
        (m) => m.type === "presence-update",
      ).length;

      // No further user action, but the keepalive re-publishes to refresh `at`
      // so peers don't expire this idle-but-connected client. (Documented
      // asymmetry vs cursors, which fade to identity-only instead.)
      await vi.advanceTimersByTimeAsync(11_000);
      const updatesAfterKeepalive = parsedSent().filter(
        (m) => m.type === "presence-update",
      ).length;
      expect(updatesAfterKeepalive).toBeGreaterThan(updatesAfterInitial);
    } finally {
      vi.useRealTimers();
    }
  });
});
