// ABOUTME: Tests for cursor container resolution — element, selector, getter.
// ABOUTME: Null handling and getter-on-every-call semantics.
import { describe, it, expect, beforeEach } from "vitest";
import * as Y from "yjs";
import { resolveCursorContainer } from "../container";
import { CursorClientAwareness } from "../cursor-client";

describe("resolveCursorContainer", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("returns document.body when undefined", () => {
    expect(resolveCursorContainer(undefined)).toBe(document.body);
  });

  it("returns the element when passed HTMLElement", () => {
    const el = document.createElement("div");
    document.body.appendChild(el);
    expect(resolveCursorContainer(el)).toBe(el);
  });

  it("resolves string selector", () => {
    const el = document.createElement("div");
    el.id = "cursor-layer";
    document.body.appendChild(el);
    expect(resolveCursorContainer("#cursor-layer")).toBe(el);
  });

  it("returns null when selector matches nothing", () => {
    expect(resolveCursorContainer("#missing")).toBeNull();
  });

  it("calls getter function each time", () => {
    let count = 0;
    const getter = () => {
      count++;
      return document.body;
    };
    resolveCursorContainer(getter);
    resolveCursorContainer(getter);
    expect(count).toBe(2);
  });

  it("returns null from getter when element not present", () => {
    expect(resolveCursorContainer(() => null)).toBeNull();
  });
});

describe("cursor client with container option", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    document.head.querySelectorAll("#playhtml-cursor-styles").forEach((n) => n.remove());
  });

  function makeFakeProvider() {
    const doc = new Y.Doc();
    const listeners: Array<(args: any) => void> = [];
    const remoteState: Record<string, unknown> = {};
    const awareness: any = {
      _states: new Map<number, Record<string, unknown>>(),
      getStates() {
        return this._states;
      },
      setLocalState() {},
      setLocalStateField(field: string, value: unknown) {
        const local = (this._states.get(this.clientID) as Record<string, unknown>) ?? {};
        local[field] = value;
        this._states.set(this.clientID, local);
      },
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
      remoteState,
    };
    return {
      doc,
      awareness,
      on() {},
      off() {},
    } as any;
  }

  it("appends cursor DOM into the container element", () => {
    const layer = document.createElement("div");
    layer.id = "cursor-layer";
    document.body.appendChild(layer);

    const provider = makeFakeProvider();
    const client = new CursorClientAwareness(provider, {
      enabled: true,
      container: layer,
      playerIdentity: {
        publicKey: "local-key",
        playerStyle: { colorPalette: ["#ff0000"] },
      } as any,
    });

    // Inject a remote cursor into awareness and trigger change.
    const remoteClientId = 42;
    provider.awareness._states.set(remoteClientId, {
      __playhtml_cursors__: {
        connectionId: "remote-1",
        cursor: { x: 10, y: 10, pointer: "default" },
        page: "/",
        playerIdentity: {
          publicKey: "remote-1",
          playerStyle: { colorPalette: ["#00ff00"] },
        },
        lastSeen: Date.now(),
      },
    });
    provider.awareness.emit({ added: [remoteClientId], updated: [], removed: [] });

    expect(layer.querySelectorAll(".playhtml-cursor-other").length).toBeGreaterThan(0);
    expect(document.body.children[0]).toBe(layer);

    client.destroy?.();
  });

  it("injects cursor styles into the container, not document.head", () => {
    const layer = document.createElement("div");
    layer.id = "cursor-layer";
    document.body.appendChild(layer);

    const provider = makeFakeProvider();
    new CursorClientAwareness(provider, {
      enabled: true,
      container: layer,
      playerIdentity: {
        publicKey: "local-key",
        playerStyle: { colorPalette: ["#ff0000"] },
      } as any,
    });

    expect(layer.querySelector("#playhtml-cursor-styles")).not.toBeNull();
    expect(document.head.querySelector("#playhtml-cursor-styles")).toBeNull();
  });

  it("falls back to document.head when container is document.body (default)", () => {
    const provider = makeFakeProvider();
    new CursorClientAwareness(provider, {
      enabled: true,
      playerIdentity: {
        publicKey: "local-key",
        playerStyle: { colorPalette: ["#ff0000"] },
      } as any,
    });

    expect(document.head.querySelector("#playhtml-cursor-styles")).not.toBeNull();
  });

  it("migrates cursor DOM and styles when container changes", () => {
    const layerA = document.createElement("div");
    layerA.id = "layer-a";
    document.body.appendChild(layerA);

    const layerB = document.createElement("div");
    layerB.id = "layer-b";
    document.body.appendChild(layerB);

    let active: HTMLElement = layerA;
    const provider = makeFakeProvider();
    const client = new CursorClientAwareness(provider, {
      enabled: true,
      container: () => active,
      playerIdentity: {
        publicKey: "local-key",
        playerStyle: { colorPalette: ["#ff0000"] },
      } as any,
    });

    // Inject a remote cursor so DOM is in A
    const remoteClientId = 99;
    provider.awareness._states.set(remoteClientId, {
      __playhtml_cursors__: {
        connectionId: "remote-1",
        cursor: { x: 0, y: 0, pointer: "default" },
        page: "/",
        playerIdentity: {
          publicKey: "remote-1",
          playerStyle: { colorPalette: ["#00ff00"] },
        },
        lastSeen: Date.now(),
      },
    });
    provider.awareness.emit({ added: [remoteClientId], updated: [], removed: [] });

    expect(layerA.querySelectorAll(".playhtml-cursor-other").length).toBeGreaterThan(0);
    expect(layerA.querySelector("#playhtml-cursor-styles")).not.toBeNull();

    // Change container and refresh.
    active = layerB;
    client.refreshContainer();

    expect(layerA.querySelectorAll(".playhtml-cursor-other").length).toBe(0);
    expect(layerB.querySelectorAll(".playhtml-cursor-other").length).toBeGreaterThan(0);
    expect(layerB.querySelector("#playhtml-cursor-styles")).not.toBeNull();
    expect(layerA.querySelector("#playhtml-cursor-styles")).toBeNull();
  });

  it("re-invokes getCursorStyle when refreshCursorStyles is called", () => {
    const provider = makeFakeProvider();
    const calls: string[] = [];

    const client = new CursorClientAwareness(provider, {
      enabled: true,
      playerIdentity: {
        publicKey: "local-key",
        playerStyle: { colorPalette: ["#ff0000"] },
      } as any,
      getCursorStyle: (p: any) => {
        calls.push(p.playerIdentity?.publicKey ?? p.connectionId);
        return { opacity: "1" };
      },
    });

    // Inject a remote cursor
    const remoteClientId = 77;
    provider.awareness._states.set(remoteClientId, {
      __playhtml_cursors__: {
        connectionId: "remote-1",
        cursor: { x: 0, y: 0, pointer: "default" },
        page: "/",
        playerIdentity: {
          publicKey: "remote-1",
          playerStyle: { colorPalette: ["#00ff00"] },
        },
        lastSeen: Date.now(),
      },
    });
    provider.awareness.emit({ added: [remoteClientId], updated: [], removed: [] });

    const before = calls.length;
    client.refreshCursorStyles();
    expect(calls.length).toBeGreaterThan(before);
  });
});
