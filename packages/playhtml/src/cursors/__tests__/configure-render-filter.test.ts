// ABOUTME: Verifies cursor render filters reevaluate current remote presences.
// ABOUTME: Predicate changes apply without waiting for another peer update.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import { CursorClientAwareness } from "../cursor-client";

function makeFakeProvider() {
  const doc = new Y.Doc();
  const listeners: Array<(args: any) => void> = [];
  const awareness: any = {
    _states: new Map<number, Record<string, unknown>>(),
    getStates() {
      return this._states;
    },
    setLocalStateField(field: string, value: unknown) {
      const local =
        (this._states.get(this.clientID) as Record<string, unknown>) ?? {};
      local[field] = value;
      this._states.set(this.clientID, local);
    },
    getLocalState() {
      return this._states.get(this.clientID) ?? null;
    },
    on(_event: string, callback: (args: any) => void) {
      listeners.push(callback);
    },
    off() {},
    emit(args: any) {
      listeners.forEach((callback) => callback(args));
    },
    clientID: 1,
    doc,
  };

  return { doc, awareness, on() {}, off() {} } as any;
}

function addRemoteCursor(provider: ReturnType<typeof makeFakeProvider>) {
  const remoteClientId = 42;
  provider.awareness._states.set(remoteClientId, {
    __playhtml_cursors__: {
      cursor: { x: 10, y: 20, pointer: "default" },
      page: "/",
      playerIdentity: {
        publicKey: "remote-key",
        playerStyle: { colorPalette: ["#00ff00"] },
      },
      lastSeen: Date.now(),
    },
  });
  provider.awareness.emit({
    added: [remoteClientId],
    updated: [],
    removed: [],
  });
}

function makeClient(
  provider: ReturnType<typeof makeFakeProvider>,
  shouldRenderCursor?: () => boolean,
) {
  return new CursorClientAwareness(provider, {
    enabled: true,
    playerIdentity: {
      publicKey: "local-key",
      playerStyle: { colorPalette: ["#ff0000"] },
    } as any,
    shouldRenderCursor,
  });
}

describe("configure({ shouldRenderCursor })", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = "";
    document.head
      .querySelectorAll("#playhtml-cursor-styles")
      .forEach((node) => node.remove());
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("filters a rendered cursor without another peer update", () => {
    const provider = makeFakeProvider();
    const client = makeClient(provider);
    addRemoteCursor(provider);

    const cursor = document.querySelector(".playhtml-cursor-other");
    expect(cursor).not.toBeNull();

    client.configure({ shouldRenderCursor: () => false });

    expect(cursor?.classList.contains("playhtml-cursor-fade-out")).toBe(true);
    vi.advanceTimersByTime(300);
    expect(document.querySelector(".playhtml-cursor-other")).toBeNull();

    client.destroy();
  });

  it("renders a previously filtered cursor without another peer update", () => {
    const provider = makeFakeProvider();
    const client = makeClient(provider, () => false);
    addRemoteCursor(provider);

    expect(document.querySelector(".playhtml-cursor-other")).toBeNull();

    client.configure({ shouldRenderCursor: () => true });

    expect(document.querySelector(".playhtml-cursor-other")).not.toBeNull();

    client.destroy();
  });
});
