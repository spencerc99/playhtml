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

  it("removes stale keys when getCursorStyle returns fewer properties on re-apply", () => {
    const provider = makeFakeProvider();
    // Note: use style properties that aren't also managed by the cursor
    // client's visibility logic (which sets display/opacity/transform).
    // `filter` and `border` are safe to assert on.
    let returnStyles: Record<string, string> = {
      filter: "blur(3px)",
      border: "2px solid red",
    };

    const client = new CursorClientAwareness(provider, {
      enabled: true,
      playerIdentity: {
        publicKey: "local-key",
        playerStyle: { colorPalette: ["#ff0000"] },
      } as any,
      getCursorStyle: () => returnStyles,
    });

    const remoteClientId = 88;
    provider.awareness._states.set(remoteClientId, {
      __playhtml_cursors__: {
        connectionId: "remote-stale",
        cursor: { x: 0, y: 0, pointer: "default" },
        page: "/",
        playerIdentity: {
          publicKey: "remote-stale",
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

    const cursorEl = Array.from(
      document.querySelectorAll(".playhtml-cursor-other"),
    )[0] as HTMLElement;
    expect(cursorEl).toBeTruthy();
    expect(cursorEl.style.filter).toBe("blur(3px)");
    expect(cursorEl.style.border).toBe("2px solid red");

    // Now change the style function to return only filter — border should be
    // removed from the element, not linger from the previous call.
    returnStyles = { filter: "grayscale(1)" };
    client.refreshCursorStyles();

    expect(cursorEl.style.filter).toBe("grayscale(1)");
    expect(cursorEl.style.border).toBe("");
  });

  it("re-runs getCursorStyle on every remote awareness update (no zoneChanged guard)", () => {
    const provider = makeFakeProvider();
    const pagesSeen: string[] = [];

    const client = new CursorClientAwareness(provider, {
      enabled: true,
      playerIdentity: {
        publicKey: "local-key",
        playerStyle: { colorPalette: ["#ff0000"] },
      } as any,
      getCursorStyle: (p: any) => {
        pagesSeen.push(p.page);
        return {};
      },
    });

    const remoteClientId = 99;
    const basePresence = {
      connectionId: "remote-nav",
      cursor: { x: 0, y: 0, pointer: "default" },
      playerIdentity: {
        publicKey: "remote-nav",
        playerStyle: { colorPalette: ["#00ff00"] },
      },
      lastSeen: Date.now(),
    };

    provider.awareness._states.set(remoteClientId, {
      __playhtml_cursors__: { ...basePresence, page: "/a" },
    });
    provider.awareness.emit({
      added: [remoteClientId],
      updated: [],
      removed: [],
    });

    // Simulate remote client navigating (page changes, zone does not).
    provider.awareness._states.set(remoteClientId, {
      __playhtml_cursors__: { ...basePresence, page: "/b" },
    });
    provider.awareness.emit({
      added: [],
      updated: [remoteClientId],
      removed: [],
    });

    expect(pagesSeen).toContain("/a");
    expect(pagesSeen).toContain("/b");
    void client;
  });
});
