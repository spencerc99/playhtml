// ABOUTME: Tests for cursor container resolution — element, selector, getter.
// ABOUTME: Null handling and getter-on-every-call semantics.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as Y from "yjs";
import { resolveCursorContainer } from "../container";
import { CursorClientAwareness } from "../cursor-client";

const originalElementFromPoint = document.elementFromPoint;

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
  const clients: CursorClientAwareness[] = [];

  beforeEach(() => {
    document.body.innerHTML = "";
    document.head.querySelectorAll("#playhtml-cursor-styles").forEach((n) => n.remove());
  });

  afterEach(() => {
    for (const client of clients.splice(0)) {
      client.destroy();
    }
    document.body.style.cursor = "";
    document.documentElement.style.cursor = "";
    document.documentElement.style.removeProperty("--playhtml-cursor");
    document.documentElement.removeAttribute("data-playhtml-cursors-active");
    vi.useRealTimers();
    vi.restoreAllMocks();
    if (originalElementFromPoint) {
      Object.defineProperty(document, "elementFromPoint", {
        configurable: true,
        value: originalElementFromPoint,
      });
    } else {
      delete (document as any).elementFromPoint;
    }
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
      off(_event: string, cb: (args: any) => void) {
        const index = listeners.indexOf(cb);
        if (index !== -1) {
          listeners.splice(index, 1);
        }
      },
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

  function makeClient(
    provider: ReturnType<typeof makeFakeProvider>,
    options: ConstructorParameters<typeof CursorClientAwareness>[1],
  ) {
    const client = new CursorClientAwareness(provider, options);
    clients.push(client);
    return client;
  }

  it("appends cursor DOM into the container element", () => {
    const layer = document.createElement("div");
    layer.id = "cursor-layer";
    document.body.appendChild(layer);

    const provider = makeFakeProvider();
    const client = makeClient(provider, {
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
    makeClient(provider, {
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
    makeClient(provider, {
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
    const client = makeClient(provider, {
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

    const client = makeClient(provider, {
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
    // `filter` and non-shorthand properties like `backgroundColor` are
    // safe; shorthands like `border` can linger in jsdom after removeProperty.
    let returnStyles: Record<string, string> = {
      filter: "blur(3px)",
      backgroundColor: "rgb(255, 0, 0)",
    };

    const client = makeClient(provider, {
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
    expect(cursorEl.style.backgroundColor).toBe("rgb(255, 0, 0)");

    // Now change the style function to return only filter — backgroundColor
    // should be removed from the element, not linger from the previous call.
    returnStyles = { filter: "grayscale(1)" };
    client.refreshCursorStyles();

    expect(cursorEl.style.filter).toBe("grayscale(1)");
    expect(cursorEl.style.backgroundColor).toBe("");
  });

  it("clears zone-specific style keys when the cursor leaves the zone", () => {
    // Register a zone with its own getCursorStyle that sets a style property.
    // Use a longhand property (outline, not a shorthand like border) because
    // jsdom's handling of shorthand removeProperty is inconsistent.
    const zoneEl = document.createElement("div");
    zoneEl.id = "zone-a";
    document.body.appendChild(zoneEl);

    const provider = makeFakeProvider();
    const client = makeClient(provider, {
      enabled: true,
      playerIdentity: {
        publicKey: "local-key",
        playerStyle: { colorPalette: ["#ff0000"] },
      } as any,
      // Global style returns nothing — so when the cursor exits the zone,
      // the zone's style key must be cleaned up.
      getCursorStyle: () => ({}),
    });
    client.registerZone(zoneEl, {
      getCursorStyle: () => ({ outlineColor: "rgb(0, 255, 0)" }),
    });

    const remoteId = 155;
    const basePresence = {
      connectionId: "remote-zone",
      cursor: { x: 10, y: 10, pointer: "default" },
      page: "/",
      playerIdentity: {
        publicKey: "remote-zone",
        playerStyle: { colorPalette: ["#00ff00"] },
      },
      lastSeen: Date.now(),
    };

    // Enter zone.
    provider.awareness._states.set(remoteId, {
      __playhtml_cursors__: {
        ...basePresence,
        zone: { zoneId: "zone-a", relX: 0.5, relY: 0.5 },
      },
    });
    provider.awareness.emit({ added: [remoteId], updated: [], removed: [] });

    const cursorEl = Array.from(
      document.querySelectorAll(".playhtml-cursor-other"),
    )[0] as HTMLElement;
    expect(cursorEl.style.outlineColor).toBe("rgb(0, 255, 0)");

    // Exit zone — zone's outlineColor must be removed.
    provider.awareness._states.set(remoteId, {
      __playhtml_cursors__: { ...basePresence, zone: undefined },
    });
    provider.awareness.emit({ added: [], updated: [remoteId], removed: [] });

    expect(cursorEl.style.outlineColor).toBe("");
  });

  it("re-runs getCursorStyle on every remote awareness update (no zoneChanged guard)", () => {
    const provider = makeFakeProvider();
    const pagesSeen: string[] = [];

    const client = makeClient(provider, {
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

  it("keeps the colored cursor when the browser normalizes its own cursor data URL", () => {
    const provider = makeFakeProvider();
    const client = makeClient(provider, {
      enabled: true,
      playerIdentity: {
        publicKey: "local-key",
        playerStyle: { colorPalette: ["#ff0000"] },
      } as any,
    });

    const coloredCursor =
      document.documentElement.style.getPropertyValue("--playhtml-cursor");
    const urlMatch = coloredCursor.match(/^url\("(.*)"\), auto$/);
    expect(urlMatch).not.toBeNull();

    const decodedCursor = `url("${decodeURIComponent(urlMatch![1])}"), auto`;
    document.body.style.cursor = decodedCursor;
    Object.defineProperty(document, "elementFromPoint", {
      configurable: true,
      value: vi.fn(() => document.body),
    });

    document.dispatchEvent(
      new MouseEvent("mousemove", {
        clientX: 10,
        clientY: 10,
      }),
    );

    expect(document.documentElement.getAttribute("data-playhtml-cursors-active")).toBe(
      "true",
    );
    expect(document.documentElement.style.getPropertyValue("--playhtml-cursor")).toBe(
      coloredCursor,
    );
    client.destroy();
  });

  it("does not publish pending cursor updates after destroy", () => {
    vi.useFakeTimers();
    Object.defineProperty(document, "elementFromPoint", {
      configurable: true,
      value: vi.fn(() => document.body),
    });
    const provider = makeFakeProvider();
    const client = makeClient(provider, {
      enabled: true,
      playerIdentity: {
        publicKey: "local-key",
        playerStyle: { colorPalette: ["#ff0000"] },
      } as any,
    });

    document.dispatchEvent(
      new MouseEvent("mousemove", {
        clientX: 10,
        clientY: 10,
      }),
    );
    client.destroy();
    document.dispatchEvent(
      new MouseEvent("mousemove", {
        clientX: 20,
        clientY: 20,
      }),
    );
    vi.runOnlyPendingTimers();

    expect(provider.awareness.getLocalState().__playhtml_cursors__).toBeNull();
  });

  it("does not render remote cursor updates after destroy", () => {
    const layer = document.createElement("div");
    layer.id = "cursor-layer";
    document.body.appendChild(layer);

    const provider = makeFakeProvider();
    const client = makeClient(provider, {
      enabled: true,
      container: layer,
      playerIdentity: {
        publicKey: "local-key",
        playerStyle: { colorPalette: ["#ff0000"] },
      } as any,
    });

    client.destroy();
    provider.awareness._states.set(99, {
      __playhtml_cursors__: {
        cursor: { x: 10, y: 10, pointer: "mouse" },
        page: "/",
        playerIdentity: {
          publicKey: "remote-1",
          playerStyle: { colorPalette: ["#00ff00"] },
        },
        lastSeen: Date.now(),
      },
    });
    provider.awareness.emit({ added: [99], updated: [], removed: [] });

    expect(layer.querySelectorAll(".playhtml-cursor-other")).toHaveLength(0);
  });

  it("uses the native cursor while hovering a different custom cursor", () => {
    const provider = makeFakeProvider();
    const client = makeClient(provider, {
      enabled: true,
      playerIdentity: {
        publicKey: "local-key",
        playerStyle: { colorPalette: ["#ff0000"] },
      } as any,
    });

    const customCursor =
      "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciLz4=";
    document.body.style.cursor = `url("${customCursor}"), auto`;
    Object.defineProperty(document, "elementFromPoint", {
      configurable: true,
      value: vi.fn(() => document.body),
    });

    document.dispatchEvent(
      new MouseEvent("mousemove", {
        clientX: 10,
        clientY: 10,
      }),
    );

    const state = provider.awareness.getLocalState().__playhtml_cursors__;
    expect(document.documentElement.getAttribute("data-playhtml-cursors-active")).toBeNull();
    expect(state.cursor.pointer).toBe(customCursor);
    client.destroy();
  });

  it("activates a document-level cursor override for descendants with normal cursor keywords", () => {
    const target = document.createElement("button");
    target.style.cursor = "pointer";
    document.body.appendChild(target);

    const provider = makeFakeProvider();
    const client = makeClient(provider, {
      enabled: true,
      playerIdentity: {
        publicKey: "local-key",
        playerStyle: { colorPalette: ["#ff0000"] },
      } as any,
    });

    const coloredCursor =
      document.documentElement.style.getPropertyValue("--playhtml-cursor");

    expect(document.documentElement.getAttribute("data-playhtml-cursors-active")).toBe(
      "true",
    );
    expect(document.documentElement.style.getPropertyValue("--playhtml-cursor")).toBe(
      coloredCursor,
    );
    expect(document.getElementById("playhtml-cursor-styles")?.textContent).toContain(
      "html[data-playhtml-cursors-active=\"true\"] *",
    );
    client.destroy();
  });

  it("does not churn the cursor override while moving over normal cursor keywords", () => {
    const target = document.createElement("button");
    target.style.cursor = "pointer";
    document.body.appendChild(target);
    Object.defineProperty(document, "elementFromPoint", {
      configurable: true,
      value: vi.fn(() => target),
    });

    const provider = makeFakeProvider();
    const client = makeClient(provider, {
      enabled: true,
      playerIdentity: {
        publicKey: "local-key",
        playerStyle: { colorPalette: ["#ff0000"] },
      } as any,
    });

    document.dispatchEvent(
      new MouseEvent("mousemove", {
        clientX: 10,
        clientY: 10,
      }),
    );

    const removeAttribute = vi.spyOn(document.documentElement, "removeAttribute");
    const setAttribute = vi.spyOn(document.documentElement, "setAttribute");

    document.dispatchEvent(
      new MouseEvent("mousemove", {
        clientX: 10,
        clientY: 10,
      }),
    );

    expect(removeAttribute).not.toHaveBeenCalledWith(
      "data-playhtml-cursors-active",
    );
    expect(setAttribute).not.toHaveBeenCalledWith(
      "data-playhtml-cursors-active",
      "true",
    );
    client.destroy();
  });

});
