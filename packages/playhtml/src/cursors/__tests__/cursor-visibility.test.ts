// ABOUTME: Verifies remote cursor visibility and styling as they render.
// ABOUTME: Covers scrolled absolute-mode distance checks and zone style ownership.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createFakePresenceTransport,
  createTransportCursorClient,
  type FakePresenceTransport,
} from "../../__tests__/presence-test-utils";

function makeIdentity(publicKey: string, color: string) {
  return {
    publicKey,
    playerStyle: { colorPalette: [color] },
  } as any;
}

function emitRemoteCursors(
  transport: FakePresenceTransport,
  cursors: Record<string, { x: number; y: number; zone?: unknown }>,
) {
  const peers: Record<string, unknown> = {};
  for (const [key, { x, y, zone }] of Object.entries(cursors)) {
    peers[`conn-${key}`] = {
      identity: makeIdentity(key, "#00ff00"),
      cursor: {
        cursor: { x, y, pointer: "mouse" },
        page: "/",
        zone,
        at: Date.now(),
      },
    };
  }
  transport.emit({ type: "presence-sync", peers } as any);
}

function cursorElements(): HTMLElement[] {
  return Array.from(
    document.querySelectorAll<HTMLElement>(".playhtml-cursor-other"),
  );
}

describe("remote cursor rendering", () => {
  const originalScrollY = Object.getOwnPropertyDescriptor(window, "scrollY");

  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = "";
    document.head
      .querySelectorAll("#playhtml-cursor-styles")
      .forEach((node) => node.remove());
    Object.defineProperty(document, "elementFromPoint", {
      configurable: true,
      value: vi.fn(() => document.body),
    });
  });

  afterEach(() => {
    if (originalScrollY) {
      Object.defineProperty(window, "scrollY", originalScrollY);
    }
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("measures visibility in viewport pixels on a scrolled page", () => {
    Object.defineProperty(window, "scrollY", {
      configurable: true,
      value: 1000,
    });
    const transport = createFakePresenceTransport();
    const { client } = createTransportCursorClient(
      {
        enabled: true,
        playerIdentity: makeIdentity("local", "#ff0000"),
        visibilityThreshold: 100,
      },
      transport,
    );

    // Our pointer at viewport (50, 50) is document (50, 1050).
    document.dispatchEvent(
      new MouseEvent("mousemove", { clientX: 50, clientY: 50, bubbles: true }),
    );
    vi.advanceTimersByTime(Math.ceil(1000 / 60));

    // "near" is 14px away on screen; "far" is the same viewport spot one
    // screen up, which is 1000px away.
    emitRemoteCursors(transport, {
      near: { x: 60, y: 1060 },
      far: { x: 60, y: 60 },
    });

    // Absolute-mode cursors are positioned at their document coordinates.
    const byTop = (top: string) =>
      cursorElements().find((element) => element.style.top === top)!;
    const near = byTop("1060px");
    const far = byTop("60px");
    expect(near.style.display).toBe("block");
    expect(far.style.display).toBe("none");

    client.destroy();
  });

  it("applies only the zone style to a cursor created inside a zone", () => {
    const zoneElement = document.createElement("div");
    zoneElement.id = "zone";
    document.body.appendChild(zoneElement);

    const transport = createFakePresenceTransport();
    const { client } = createTransportCursorClient(
      {
        enabled: true,
        playerIdentity: makeIdentity("local", "#ff0000"),
        getCursorStyle: () => ({ filter: "blur(2px)" }),
      },
      transport,
    );
    client.registerZone(zoneElement, {
      getCursorStyle: () => ({ outline: "1px solid red" }),
    });

    emitRemoteCursors(transport, {
      remote: { x: 10, y: 10, zone: { zoneId: "zone", relX: 0.5, relY: 0.5 } },
    });

    const [cursor] = cursorElements();
    expect(cursor.style.outline).toBe("1px solid red");
    expect(cursor.style.filter).toBe("");

    client.destroy();
  });
});
