// ABOUTME: Verifies cursor awareness network pacing changes with room load.
// ABOUTME: Keeps cursor movement ephemeral so shared document data is untouched.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import { CursorClientAwareness } from "../cursor-client";
import { getCursorNetworkIntervalMs } from "../cursor-network-pacing";

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
    expect(getCursorNetworkIntervalMs(8)).toBeCloseTo(1000 / 60);
  });

  it("lowers the network rate when a room has about twenty cursor connections", () => {
    expect(getCursorNetworkIntervalMs(20)).toBeGreaterThan(1000 / 60);
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
});
