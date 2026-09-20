// ABOUTME: Tests for cursor container resolution — element, selector, getter.
// ABOUTME: Null handling and getter-on-every-call semantics.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { resolveCursorContainer } from "../container";
import { createTransportCursorClient } from "../../__tests__/presence-test-utils";

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
  const clients: Array<{ destroy(): void }> = [];
  afterEach(() => {
    for (const client of clients.splice(0)) client.destroy();
  });
  beforeEach(() => {
    document.body.innerHTML = "";
    document.head
      .querySelectorAll("#playhtml-cursor-styles")
      .forEach((n) => n.remove());
  });

  it("appends cursor DOM into the container element", () => {
    const layer = document.createElement("div");
    layer.id = "cursor-layer";
    document.body.appendChild(layer);

    const { client, transport } = createTransportCursorClient({
      enabled: true,
      container: layer,
      playerIdentity: {
        publicKey: "local-key",
        playerStyle: { colorPalette: ["#ff0000"] },
      } as any,
    });
    clients.push(client);

    // Deliver a remote cursor through the presence protocol.
    transport.emit({
      type: "presence-sync",
      peers: {
        remote: {
          identity: {
            publicKey: "remote-1",
            playerStyle: { colorPalette: ["#00ff00"] },
          },
          cursor: {
            cursor: { x: 10, y: 10, pointer: "default" },
            page: "/",

            at: Date.now(),
          },
        },
      },
    });

    expect(
      layer.querySelectorAll(".playhtml-cursor-other").length,
    ).toBeGreaterThan(0);
    expect(document.body.children[0]).toBe(layer);

    client.destroy?.();
  });

  it("injects cursor styles into the container, not document.head", () => {
    const layer = document.createElement("div");
    layer.id = "cursor-layer";
    document.body.appendChild(layer);

    const { client, transport } = createTransportCursorClient({
      enabled: true,
      container: layer,
      playerIdentity: {
        publicKey: "local-key",
        playerStyle: { colorPalette: ["#ff0000"] },
      } as any,
    });
    clients.push(client);

    expect(layer.querySelector("#playhtml-cursor-styles")).not.toBeNull();
    expect(document.head.querySelector("#playhtml-cursor-styles")).toBeNull();
  });

  it("falls back to document.head when container is document.body (default)", () => {
    const { client, transport } = createTransportCursorClient({
      enabled: true,
      playerIdentity: {
        publicKey: "local-key",
        playerStyle: { colorPalette: ["#ff0000"] },
      } as any,
    });
    clients.push(client);

    expect(
      document.head.querySelector("#playhtml-cursor-styles"),
    ).not.toBeNull();
  });

  it("migrates cursor DOM and styles when container changes", () => {
    const layerA = document.createElement("div");
    layerA.id = "layer-a";
    document.body.appendChild(layerA);

    const layerB = document.createElement("div");
    layerB.id = "layer-b";
    document.body.appendChild(layerB);

    let active: HTMLElement = layerA;
    const { client, transport } = createTransportCursorClient({
      enabled: true,
      container: () => active,
      playerIdentity: {
        publicKey: "local-key",
        playerStyle: { colorPalette: ["#ff0000"] },
      } as any,
    });
    clients.push(client);

    // Inject a remote cursor so DOM is in A
    transport.emit({
      type: "presence-sync",
      peers: {
        remote: {
          identity: {
            publicKey: "remote-1",
            playerStyle: { colorPalette: ["#00ff00"] },
          },
          cursor: {
            cursor: { x: 0, y: 0, pointer: "default" },
            page: "/",

            at: Date.now(),
          },
        },
      },
    });

    expect(
      layerA.querySelectorAll(".playhtml-cursor-other").length,
    ).toBeGreaterThan(0);
    expect(layerA.querySelector("#playhtml-cursor-styles")).not.toBeNull();

    // Change container and refresh.
    active = layerB;
    client.refreshContainer();

    expect(layerA.querySelectorAll(".playhtml-cursor-other").length).toBe(0);
    expect(
      layerB.querySelectorAll(".playhtml-cursor-other").length,
    ).toBeGreaterThan(0);
    expect(layerB.querySelector("#playhtml-cursor-styles")).not.toBeNull();
    expect(layerA.querySelector("#playhtml-cursor-styles")).toBeNull();
  });

  it("re-invokes getCursorStyle when refreshCursorStyles is called", () => {
    const calls: string[] = [];

    const { client, transport } = createTransportCursorClient({
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
    clients.push(client);

    // Inject a remote cursor
    transport.emit({
      type: "presence-sync",
      peers: {
        remote: {
          identity: {
            publicKey: "remote-1",
            playerStyle: { colorPalette: ["#00ff00"] },
          },
          cursor: {
            cursor: { x: 0, y: 0, pointer: "default" },
            page: "/",

            at: Date.now(),
          },
        },
      },
    });

    const before = calls.length;
    client.refreshCursorStyles();
    expect(calls.length).toBeGreaterThan(before);
  });

  it("removes stale keys when getCursorStyle returns fewer properties on re-apply", () => {
    // Note: use style properties that aren't also managed by the cursor
    // client's visibility logic (which sets display/opacity/transform).
    // `filter` and non-shorthand properties like `backgroundColor` are
    // safe; shorthands like `border` can linger in jsdom after removeProperty.
    let returnStyles: Record<string, string> = {
      filter: "blur(3px)",
      backgroundColor: "rgb(255, 0, 0)",
    };

    const { client, transport } = createTransportCursorClient({
      enabled: true,
      playerIdentity: {
        publicKey: "local-key",
        playerStyle: { colorPalette: ["#ff0000"] },
      } as any,
      getCursorStyle: () => returnStyles,
    });
    clients.push(client);

    transport.emit({
      type: "presence-sync",
      peers: {
        remote: {
          identity: {
            publicKey: "remote-stale",
            playerStyle: { colorPalette: ["#00ff00"] },
          },
          cursor: {
            cursor: { x: 0, y: 0, pointer: "default" },
            page: "/",

            at: Date.now(),
          },
        },
      },
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

    const { client, transport } = createTransportCursorClient({
      enabled: true,
      playerIdentity: {
        publicKey: "local-key",
        playerStyle: { colorPalette: ["#ff0000"] },
      } as any,
      // Global style returns nothing — so when the cursor exits the zone,
      // the zone's style key must be cleaned up.
      getCursorStyle: () => ({}),
    });
    clients.push(client);
    client.registerZone(zoneEl, {
      getCursorStyle: () => ({ outlineColor: "rgb(0, 255, 0)" }),
    });

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
    transport.emit({
      type: "presence-sync",
      peers: {
        remote: {
          identity: basePresence.playerIdentity,
          cursor: {
            ...basePresence,
            at: basePresence.lastSeen,
            zone: { zoneId: "zone-a", relX: 0.5, relY: 0.5 },
          },
        },
      },
    });

    const cursorEl = Array.from(
      document.querySelectorAll(".playhtml-cursor-other"),
    )[0] as HTMLElement;
    expect(cursorEl.style.outlineColor).toBe("rgb(0, 255, 0)");

    // Exit zone — zone's outlineColor must be removed.
    transport.emit({
      type: "presence-sync",
      peers: {
        remote: {
          identity: basePresence.playerIdentity,
          cursor: {
            ...basePresence,
            at: basePresence.lastSeen,
            zone: undefined,
          },
        },
      },
    });

    expect(cursorEl.style.outlineColor).toBe("");
  });

  it("re-runs getCursorStyle on every remote cursor update", () => {
    const pagesSeen: string[] = [];

    const { client, transport } = createTransportCursorClient({
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
    clients.push(client);

    const basePresence = {
      connectionId: "remote-nav",
      cursor: { x: 0, y: 0, pointer: "default" },
      playerIdentity: {
        publicKey: "remote-nav",
        playerStyle: { colorPalette: ["#00ff00"] },
      },
      lastSeen: Date.now(),
    };

    transport.emit({
      type: "presence-sync",
      peers: {
        remote: {
          identity: basePresence.playerIdentity,
          cursor: { ...basePresence, at: basePresence.lastSeen, page: "/a" },
        },
      },
    });

    // Simulate remote client navigating (page changes, zone does not).
    transport.emit({
      type: "presence-sync",
      peers: {
        remote: {
          identity: basePresence.playerIdentity,
          cursor: { ...basePresence, at: basePresence.lastSeen, page: "/b" },
        },
      },
    });

    expect(pagesSeen).toContain("/a");
    expect(pagesSeen).toContain("/b");
    void client;
  });
});
