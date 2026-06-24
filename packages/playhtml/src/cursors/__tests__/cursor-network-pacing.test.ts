// ABOUTME: Verifies cursor awareness network pacing changes with room load.
// ABOUTME: Keeps cursor movement ephemeral so shared document data is untouched.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import { CursorClientAwareness } from "../cursor-client";
import {
  getCursorNetworkHz,
  getCursorNetworkIntervalMs,
} from "../cursor-network-pacing";

function makeIdentity(publicKey: string, color: string) {
  return {
    publicKey,
    playerStyle: { colorPalette: [color] },
  } as any;
}

function makeFakeProvider() {
  const doc = new Y.Doc();
  const listeners: Array<(args: any) => void> = [];
  const localState: Record<string, unknown> = {};
  const awareness: any = {
    _states: new Map<number, Record<string, unknown>>(),
    getStates() {
      return this._states;
    },
    setLocalState() {},
    setLocalStateField: vi.fn((field: string, value: unknown) => {
      localState[field] = value;
      awareness._states.set(awareness.clientID, { ...localState });
    }),
    getLocalState() {
      return this._states.get(this.clientID) ?? null;
    },
    on(_event: string, cb: (args: any) => void) {
      listeners.push(cb);
    },
    off() {},
    emit(args: any) {
      listeners.forEach((cb) => cb(args));
    },
    clientID: 1,
    doc,
  };
  return { doc, awareness, on() {}, off() {} } as any;
}

function addRemoteCursors(provider: any, count: number) {
  const added: number[] = [];
  for (let i = 0; i < count; i++) {
    const clientId = i + 2;
    added.push(clientId);
    provider.awareness._states.set(clientId, {
      __playhtml_cursors__: {
        cursor: { x: i, y: i, pointer: "mouse" },
        page: "/",
        playerIdentity: makeIdentity(
          `remote-${i}`,
          `#${String(i + 1).padStart(6, "0")}`,
        ),
        lastSeen: Date.now(),
      },
    });
  }
  provider.awareness.emit({ added, updated: [], removed: [] });
}

function dispatchMouseMove(x: number, y: number) {
  document.dispatchEvent(
    new MouseEvent("mousemove", {
      clientX: x,
      clientY: y,
      bubbles: true,
    }),
  );
}

function makeFakePresenceTransport() {
  const listeners = new Set<(message: unknown) => void>();
  const statusListeners = new Set<(status: "open" | "close" | "error") => void>();
  return {
    updates: [] as Array<{ channel: string; value: unknown }>,
    clears: [] as string[],
    join: vi.fn(),
    update(channel: string, value: unknown) {
      this.updates.push({ channel, value });
    },
    clear(channel: string) {
      this.clears.push(channel);
    },
    subscribe: vi.fn((listener: (message: unknown) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }),
    emit(message: unknown) {
      for (const listener of listeners) listener(message);
    },
    subscribeStatus: vi.fn((listener: (status: "open" | "close" | "error") => void) => {
      statusListeners.add(listener);
      return () => statusListeners.delete(listener);
    }),
    emitStatus(status: "open" | "close" | "error") {
      for (const listener of statusListeners) listener(status);
    },
    destroy: vi.fn(),
  };
}

describe("cursor network pacing", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = "";
    document.head
      .querySelectorAll("#playhtml-cursor-styles")
      .forEach((n) => n.remove());
    Object.defineProperty(document, "elementFromPoint", {
      configurable: true,
      value: vi.fn(() => document.body),
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("keeps the network interval at 60Hz for small rooms", () => {
    expect(getCursorNetworkIntervalMs(1)).toBeCloseTo(1000 / 60);
    expect(getCursorNetworkIntervalMs(6)).toBeCloseTo(1000 / 60);
  });

  it("backs off by fanout after the sixth cursor connection", () => {
    expect(getCursorNetworkHz(7)).toBeCloseTo(600 / 7 ** 2);
    expect(getCursorNetworkHz(8)).toBeCloseTo(600 / 8 ** 2);
    expect(getCursorNetworkHz(12)).toBeCloseTo(600 / 12 ** 2);
    expect(getCursorNetworkHz(20)).toBeCloseTo(1.5);
  });

  it("does not publish at a 60Hz interval when about twenty cursor connections are active", () => {
    const provider = makeFakeProvider();
    const client = new CursorClientAwareness(provider, {
      enabled: true,
      playerIdentity: makeIdentity("local", "#ff0000"),
    });
    addRemoteCursors(provider, 19);
    const initialCallCount =
      provider.awareness.setLocalStateField.mock.calls.length;

    dispatchMouseMove(10, 20);
    vi.advanceTimersByTime(Math.ceil(1000 / 60));

    expect(provider.awareness.setLocalStateField).toHaveBeenCalledTimes(
      initialCallCount,
    );

    vi.advanceTimersByTime(
      Math.ceil(getCursorNetworkIntervalMs(20) - (1000 / 60)),
    );

    expect(provider.awareness.setLocalStateField).toHaveBeenCalledTimes(
      initialCallCount + 1,
    );

    client.destroy();
  });

  it("coalesces pointer processing to one DOM hit-test per animation frame", () => {
    const provider = makeFakeProvider();
    const client = new CursorClientAwareness(provider, {
      enabled: true,
      playerIdentity: makeIdentity("local", "#ff0000"),
    });
    const elementFromPoint = vi.mocked(document.elementFromPoint);
    elementFromPoint.mockClear();

    dispatchMouseMove(10, 20);
    dispatchMouseMove(11, 21);
    dispatchMouseMove(12, 22);

    expect(elementFromPoint).not.toHaveBeenCalled();

    vi.advanceTimersByTime(Math.ceil(1000 / 60));

    expect(elementFromPoint).toHaveBeenCalledTimes(1);

    client.destroy();
  });

  it("does not publish a pending movement update after a direct awareness update", () => {
    const provider = makeFakeProvider();
    const client = new CursorClientAwareness(provider, {
      enabled: true,
      playerIdentity: makeIdentity("local", "#ff0000"),
    });
    addRemoteCursors(provider, 19);
    dispatchMouseMove(10, 20);
    vi.advanceTimersByTime(Math.ceil(1000 / 60));

    const callCountBeforeIdentityChange =
      provider.awareness.setLocalStateField.mock.calls.length;
    client.configure({
      playerIdentity: makeIdentity("local", "#00ff00"),
    });
    const callCountAfterIdentityChange =
      provider.awareness.setLocalStateField.mock.calls.length;

    expect(callCountAfterIdentityChange).toBe(callCountBeforeIdentityChange + 1);

    vi.advanceTimersByTime(Math.ceil(getCursorNetworkIntervalMs(20)));

    expect(provider.awareness.setLocalStateField).toHaveBeenCalledTimes(
      callCountAfterIdentityChange,
    );

    client.destroy();
  });

  it("publishes movement through presence transport instead of cursor awareness when available", () => {
    const provider = makeFakeProvider();
    const transport = makeFakePresenceTransport();
    const client = new CursorClientAwareness(
      provider,
      {
        enabled: true,
        playerIdentity: makeIdentity("local", "#ff0000"),
      },
      transport as any,
    );
    provider.awareness.setLocalStateField.mockClear();

    dispatchMouseMove(10, 20);
    vi.advanceTimersByTime(Math.ceil(1000 / 60));

    expect(provider.awareness.setLocalStateField).not.toHaveBeenCalledWith(
      "__playhtml_cursors__",
      expect.anything(),
    );
    expect(transport.updates).toHaveLength(1);
    expect(transport.updates[0]).toEqual({
      channel: "cursor",
      value: expect.objectContaining({
        cursor: { x: 10, y: 20, pointer: "mouse" },
        page: "/",
      }),
    });

    client.destroy();
  });

  it("notifies local cursor presence listeners without waiting for transport echo", () => {
    const provider = makeFakeProvider();
    const transport = makeFakePresenceTransport();
    const client = new CursorClientAwareness(
      provider,
      {
        enabled: true,
        playerIdentity: makeIdentity("local", "#ff0000"),
      },
      transport as any,
    );
    const snapshots: Array<Map<string, any>> = [];
    client.onCursorPresencesChange((presences) => {
      snapshots.push(new Map(presences));
    });

    dispatchMouseMove(10, 20);
    vi.advanceTimersByTime(Math.ceil(1000 / 60));

    expect(snapshots).toHaveLength(1);
    expect(snapshots[0].get("local")).toMatchObject({
      cursor: { x: 10, y: 20, pointer: "mouse" },
      playerIdentity: makeIdentity("local", "#ff0000"),
      page: "/",
    });

    client.destroy();
  });

  it("renders remote cursors from presence transport sync messages", () => {
    const provider = makeFakeProvider();
    const transport = makeFakePresenceTransport();
    const client = new CursorClientAwareness(
      provider,
      {
        enabled: true,
        playerIdentity: makeIdentity("local", "#ff0000"),
      },
      transport as any,
    );

    transport.emit({
      type: "presence-sync",
      peers: {
        "conn-remote": {
          identity: makeIdentity("remote", "#00ff00"),
          cursor: {
            cursor: { x: 10, y: 20, pointer: "mouse" },
            page: "/",
            zone: null,
            at: Date.now(),
          },
        },
      },
    });

    expect(document.querySelector(".playhtml-cursor-other")).not.toBe(null);
    expect(client.getCursorPresences().get("remote")?.cursor).toEqual({
      x: 10,
      y: 20,
      pointer: "mouse",
    });

    client.destroy();
  });

  it("ignores unsafe remote custom cursor URLs", () => {
    const provider = makeFakeProvider();
    const transport = makeFakePresenceTransport();
    const client = new CursorClientAwareness(
      provider,
      {
        enabled: true,
        playerIdentity: makeIdentity("local", "#ff0000"),
      },
      transport as any,
    );

    transport.emit({
      type: "presence-sync",
      peers: {
        "conn-remote": {
          identity: makeIdentity("remote", "#00ff00"),
          cursor: {
            cursor: {
              x: 10,
              y: 20,
              pointer: 'x" onload="alert(1)',
            },
            page: "/",
            zone: null,
            at: Date.now(),
          },
        },
      },
    });

    expect(document.querySelector(".playhtml-cursor-other")).not.toBe(null);
    expect(document.querySelector(".playhtml-cursor-other image")).toBe(null);

    client.destroy();
  });

  it("backs off transport-backed cursor publishing when about twenty peers are present", () => {
    const provider = makeFakeProvider();
    const transport = makeFakePresenceTransport();
    const client = new CursorClientAwareness(
      provider,
      {
        enabled: true,
        playerIdentity: makeIdentity("local", "#ff0000"),
      },
      transport as any,
    );
    const peers: Record<string, any> = {};
    for (let i = 0; i < 19; i++) {
      peers[`conn-${i}`] = {
        identity: makeIdentity(
          `remote-${i}`,
          `#${String(i + 1).padStart(6, "0")}`,
        ),
        cursor: {
          cursor: { x: i, y: i, pointer: "mouse" },
          page: "/",
          zone: null,
          at: Date.now(),
        },
      };
    }
    transport.emit({ type: "presence-sync", peers });
    transport.updates = [];

    dispatchMouseMove(10, 20);
    vi.advanceTimersByTime(Math.ceil(1000 / 60));

    expect(transport.updates).toHaveLength(0);

    vi.advanceTimersByTime(
      Math.ceil(getCursorNetworkIntervalMs(20) - (1000 / 60)),
    );

    expect(transport.updates).toHaveLength(1);

    client.destroy();
  });

  it("keeps transport publishing at 60Hz when joined peers have no active cursor", () => {
    const provider = makeFakeProvider();
    const transport = makeFakePresenceTransport();
    const client = new CursorClientAwareness(
      provider,
      {
        enabled: true,
        playerIdentity: makeIdentity("local", "#ff0000"),
      },
      transport as any,
    );
    const peers: Record<string, any> = {};
    for (let i = 0; i < 19; i++) {
      peers[`conn-${i}`] = {
        identity: makeIdentity(
          `remote-${i}`,
          `#${String(i + 1).padStart(6, "0")}`,
        ),
        page: "/",
      };
    }
    transport.emit({ type: "presence-sync", peers });
    transport.updates = [];

    dispatchMouseMove(10, 20);
    vi.advanceTimersByTime(Math.ceil(1000 / 60));

    expect(transport.updates).toHaveLength(1);

    client.destroy();
  });

  it("expires stale transport cursor positions", () => {
    vi.setSystemTime(100_000);
    const provider = makeFakeProvider();
    const transport = makeFakePresenceTransport();
    const client = new CursorClientAwareness(
      provider,
      {
        enabled: true,
        playerIdentity: makeIdentity("local", "#ff0000"),
      },
      transport as any,
    );

    transport.emit({
      type: "presence-sync",
      peers: {
        "conn-remote": {
          identity: makeIdentity("remote", "#00ff00"),
          cursor: {
            cursor: { x: 10, y: 20, pointer: "mouse" },
            page: "/",
            zone: null,
            at: 69_000,
          },
        },
      },
    });

    expect(document.querySelector(".playhtml-cursor-other")).toBe(null);
    expect(client.getCursorPresences().get("remote")?.cursor).toBeNull();

    client.destroy();
  });

  it("checks proximity immediately after local transport cursor movement", () => {
    const provider = makeFakeProvider();
    const transport = makeFakePresenceTransport();
    const onProximityEntered = vi.fn();
    const client = new CursorClientAwareness(
      provider,
      {
        enabled: true,
        onProximityEntered,
        playerIdentity: makeIdentity("local", "#ff0000"),
      },
      transport as any,
    );

    transport.emit({
      type: "presence-sync",
      peers: {
        "conn-remote": {
          identity: makeIdentity("remote", "#00ff00"),
          cursor: {
            cursor: { x: 12, y: 22, pointer: "mouse" },
            page: "/",
            zone: null,
            at: Date.now(),
          },
        },
      },
    });

    dispatchMouseMove(10, 20);
    vi.advanceTimersByTime(Math.ceil(1000 / 60));

    expect(onProximityEntered).toHaveBeenCalledTimes(1);

    client.destroy();
  });

  it("uses server cursor rate messages as an additional publish cap", () => {
    const provider = makeFakeProvider();
    const transport = makeFakePresenceTransport();
    const client = new CursorClientAwareness(
      provider,
      {
        enabled: true,
        playerIdentity: makeIdentity("local", "#ff0000"),
      },
      transport as any,
    );
    transport.emit({ type: "presence-rate", channel: "cursor", hz: 10 });
    transport.updates = [];

    dispatchMouseMove(10, 20);
    vi.advanceTimersByTime(Math.ceil(1000 / 60));

    expect(transport.updates).toHaveLength(0);

    vi.advanceTimersByTime(Math.ceil(1000 / 10));

    expect(transport.updates).toHaveLength(1);

    client.destroy();
  });

  it("warns when the presence server rejects a message", () => {
    const provider = makeFakeProvider();
    const transport = makeFakePresenceTransport();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const client = new CursorClientAwareness(
      provider,
      {
        enabled: true,
        playerIdentity: makeIdentity("local", "#ff0000"),
      },
      transport as any,
    );

    transport.emit({ type: "presence-error", message: "bad cursor" });

    expect(warn).toHaveBeenCalledWith(
      "[playhtml] Presence server rejected message:",
      "bad cursor",
    );

    client.destroy();
  });

  it("replays join and latest cursor state when the transport opens", () => {
    const provider = makeFakeProvider();
    const transport = makeFakePresenceTransport();
    const identity = makeIdentity("local", "#ff0000");
    const client = new CursorClientAwareness(
      provider,
      {
        enabled: true,
        playerIdentity: identity,
      },
      transport as any,
    );
    transport.join.mockClear();
    transport.updates = [];

    dispatchMouseMove(10, 20);
    vi.advanceTimersByTime(Math.ceil(1000 / 60));
    transport.updates = [];
    transport.emitStatus("open");

    expect(transport.join).toHaveBeenCalledWith({
      identity,
      page: "/",
    });
    expect(transport.updates).toEqual([
      {
        channel: "cursor",
        value: expect.objectContaining({
          cursor: { x: 10, y: 20, pointer: "mouse" },
          page: "/",
        }),
      },
    ]);

    client.destroy();
  });

  it("omits overlong page paths from transport messages", () => {
    const provider = makeFakeProvider();
    const transport = makeFakePresenceTransport();
    const identity = makeIdentity("local", "#ff0000");
    const originalPath = window.location.pathname;
    window.history.pushState(null, "", `/${"x".repeat(600)}`);

    const client = new CursorClientAwareness(
      provider,
      {
        enabled: true,
        playerIdentity: identity,
      },
      transport as any,
    );
    try {
      dispatchMouseMove(10, 20);
      vi.advanceTimersByTime(Math.ceil(1000 / 60));

      expect(transport.join).toHaveBeenCalledWith({
        identity,
        page: undefined,
      });
      expect(transport.updates[0]).toEqual({
        channel: "cursor",
        value: expect.objectContaining({
          cursor: { x: 10, y: 20, pointer: "mouse" },
          page: undefined,
        }),
      });
    } finally {
      client.destroy();
      window.history.pushState(null, "", originalPath);
    }
  });

  it("repositions transport-backed remote cursors after viewport changes", () => {
    const provider = makeFakeProvider();
    const transport = makeFakePresenceTransport();
    const client = new CursorClientAwareness(
      provider,
      {
        coordinateMode: "relative",
        enabled: true,
        playerIdentity: makeIdentity("local", "#ff0000"),
      },
      transport as any,
    );
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 1000,
    });
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      value: 500,
    });

    transport.emit({
      type: "presence-sync",
      peers: {
        "conn-remote": {
          identity: makeIdentity("remote", "#00ff00"),
          cursor: {
            cursor: { x: 50, y: 50, pointer: "mouse" },
            page: "/",
            zone: null,
            at: Date.now(),
          },
        },
      },
    });
    const cursor = document.querySelector(
      ".playhtml-cursor-other",
    ) as HTMLElement;
    expect(cursor.style.left).toBe("500px");

    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 800,
    });
    window.dispatchEvent(new Event("resize"));
    vi.advanceTimersByTime(Math.ceil(1000 / 60));

    expect(cursor.style.left).toBe("400px");

    client.destroy();
  });

  it("publishes global cursor identity changes through the presence transport", () => {
    const provider = makeFakeProvider();
    const transport = makeFakePresenceTransport();
    const client = new CursorClientAwareness(
      provider,
      {
        enabled: true,
        playerIdentity: makeIdentity("local", "#ff0000"),
      },
      transport as any,
    );
    transport.updates = [];

    window.cursors.color = "#00ff00";
    window.cursors.name = "Ada";

    expect(
      transport.updates.filter((update) => update.channel === "identity"),
    ).toEqual([
      {
        channel: "identity",
        value: expect.objectContaining({
          playerStyle: { colorPalette: ["#00ff00"] },
          publicKey: "local",
        }),
      },
      {
        channel: "identity",
        value: expect.objectContaining({
          name: "Ada",
          publicKey: "local",
        }),
      },
    ]);

    client.destroy();
  });

  it("keeps the local player in allColors on the presence transport path", () => {
    const provider = makeFakeProvider();
    const transport = makeFakePresenceTransport();
    const client = new CursorClientAwareness(
      provider,
      {
        enabled: true,
        playerIdentity: makeIdentity("local", "#ff0000"),
      },
      transport as any,
    );

    transport.emit({
      type: "presence-sync",
      peers: {
        "conn-remote": {
          identity: makeIdentity("remote", "#00ff00"),
          cursor: {
            cursor: { x: 10, y: 20, pointer: "mouse" },
            page: "/",
            zone: null,
            at: Date.now(),
          },
        },
      },
    });

    expect(client.getSnapshot().allColors).toEqual(["#ff0000", "#00ff00"]);
    expect(window.cursors.allColors).toEqual(["#ff0000", "#00ff00"]);

    client.destroy();
  });
});
