// ABOUTME: Verifies cursor presence network pacing changes with room load.
// ABOUTME: Keeps cursor movement ephemeral so shared document data is untouched.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getCursorNetworkHz,
  getCursorNetworkIntervalMs,
} from "../cursor-network-pacing";
import { createTransportCursorClient } from "../../__tests__/presence-test-utils";

function makeIdentity(publicKey: string, color: string) {
  return {
    publicKey,
    playerStyle: { colorPalette: [color] },
  } as any;
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
    expect(getCursorNetworkIntervalMs(30)).toBeCloseTo(1000 / 60);
  });

  it("caps sustained room load after small rooms", () => {
    expect(getCursorNetworkHz(31)).toBeCloseTo(30);
    expect(getCursorNetworkHz(50)).toBeCloseTo(30);
    expect(getCursorNetworkHz(100)).toBeCloseTo(150_000 / (100 * 99));
    expect(getCursorNetworkHz(200)).toBeCloseTo(150_000 / (200 * 199));
  });

  it("publishes pointer coordinates through the presence transport", () => {
    const { client, transport } = createTransportCursorClient({
      enabled: true,
      playerIdentity: makeIdentity("local", "#ff0000"),
    });

    dispatchMouseMove(10, 20);
    vi.advanceTimersByTime(Math.ceil(1000 / 60));

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
    const { client, transport } = createTransportCursorClient({
      enabled: true,
      playerIdentity: makeIdentity("local", "#ff0000"),
    });
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
    const { client, transport } = createTransportCursorClient({
      enabled: true,
      playerIdentity: makeIdentity("local", "#ff0000"),
    });
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
    const { client, transport } = createTransportCursorClient({
      enabled: true,
      playerIdentity: makeIdentity("local", "#ff0000"),
    });
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

  it("backs off transport-backed cursor publishing when about fifty peers are present", () => {
    const { client, transport } = createTransportCursorClient({
      enabled: true,
      playerIdentity: makeIdentity("local", "#ff0000"),
    });
    const peers: Record<string, any> = {};
    for (let i = 0; i < 49; i++) {
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
      Math.ceil(getCursorNetworkIntervalMs(50) - 1000 / 60),
    );

    expect(transport.updates).toHaveLength(1);

    client.destroy();
  });

  it("keeps transport publishing at 60Hz when joined peers have no active cursor", () => {
    const { client, transport } = createTransportCursorClient({
      enabled: true,
      playerIdentity: makeIdentity("local", "#ff0000"),
    });
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
    const { client, transport } = createTransportCursorClient({
      enabled: true,
      playerIdentity: makeIdentity("local", "#ff0000"),
    });

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
    const onProximityEntered = vi.fn();
    const { client, transport } = createTransportCursorClient({
      enabled: true,
      onProximityEntered,
      playerIdentity: makeIdentity("local", "#ff0000"),
    });

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
    const { client, transport } = createTransportCursorClient({
      enabled: true,
      playerIdentity: makeIdentity("local", "#ff0000"),
    });
    transport.emit({ type: "presence-rate", channel: "cursor", hz: 10 });
    transport.updates = [];

    dispatchMouseMove(10, 20);
    vi.advanceTimersByTime(Math.ceil(1000 / 60));

    expect(transport.updates).toHaveLength(0);

    vi.advanceTimersByTime(Math.ceil(1000 / 10));

    expect(transport.updates).toHaveLength(1);

    client.destroy();
  });

  it("does not duplicate transport rejection warnings", () => {
    // Rejection logging belongs to the transport, once per socket.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { client, transport } = createTransportCursorClient({
      enabled: true,
      playerIdentity: makeIdentity("local", "#ff0000"),
    });

    transport.emit({ type: "presence-error", message: "bad cursor" });

    expect(warn).not.toHaveBeenCalledWith(
      expect.stringContaining("rejected"),
      expect.anything(),
    );

    client.destroy();
    warn.mockRestore();
  });

  it("omits overlong page paths from transport messages", () => {
    const identity = makeIdentity("local", "#ff0000");
    const originalPath = window.location.pathname;
    window.history.pushState(null, "", `/${"x".repeat(600)}`);

    const { client, transport } = createTransportCursorClient({
      enabled: true,
      playerIdentity: identity,
    });
    try {
      dispatchMouseMove(10, 20);
      vi.advanceTimersByTime(Math.ceil(1000 / 60));

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
    const { client, transport } = createTransportCursorClient({
      coordinateMode: "relative",
      enabled: true,
      playerIdentity: makeIdentity("local", "#ff0000"),
    });
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

  it("does not republish the identity channel itself on self-change (transport owns it)", () => {
    // The transport owns identity broadcasting; cursor clients only render it.
    const { client, transport } = createTransportCursorClient({
      enabled: true,
      playerIdentity: makeIdentity("local", "#ff0000"),
    });
    transport.updates = [];

    const colors: string[] = [];
    const names: Array<string | undefined> = [];
    window.cursors.on("color", (c: string) => colors.push(c));
    window.cursors.on("name", (n: string | undefined) => names.push(n));

    window.cursors.color = "#00ff00";
    window.cursors.name = "Ada";

    // No identity-channel updates from the cursor client.
    expect(
      transport.updates.filter((update) => update.channel === "identity"),
    ).toEqual([]);
    // But cursor awareness still republishes (cursor rendering source of truth).
    expect(
      transport.updates.some((update) => update.channel === "cursor"),
    ).toBe(true);
    // And CursorEvents subscribers still fire for changed fields.
    expect(colors).toContain("#00ff00");
    expect(names).toContain("Ada");

    client.destroy();
  });

  it("keeps the local player in allColors on the presence transport path", () => {
    const { client, transport } = createTransportCursorClient({
      enabled: true,
      playerIdentity: makeIdentity("local", "#ff0000"),
    });
    const allColorEvents: string[][] = [];
    client.on("allColors", (colors) => allColorEvents.push(colors));

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

    expect(client.getSnapshot().allColors.sort()).toEqual([
      "#00ff00",
      "#ff0000",
    ]);
    expect(window.cursors.allColors.sort()).toEqual(["#00ff00", "#ff0000"]);
    expect(
      allColorEvents.map((colors) => colors.slice().sort()),
    ).toContainEqual(["#00ff00", "#ff0000"]);
    expect(
      Object.getOwnPropertyDescriptor(window.cursors, "allColors")?.set,
    ).toBeUndefined();

    client.destroy();
  });

  it("coalesces pointer processing to one DOM hit-test per animation frame", () => {
    const { client, transport } = createTransportCursorClient({
      enabled: true,
      playerIdentity: makeIdentity("local", "#ff0000"),
    });
    const hitTest = vi.mocked(document.elementFromPoint);
    hitTest.mockClear();
    dispatchMouseMove(10, 20);
    dispatchMouseMove(11, 21);
    dispatchMouseMove(12, 22);
    expect(hitTest).not.toHaveBeenCalled();
    vi.advanceTimersByTime(Math.ceil(1000 / 60));
    expect(hitTest).toHaveBeenCalledTimes(1);
    expect(transport.updates).toHaveLength(1);
    expect(transport.updates[0].value).toMatchObject({
      cursor: { x: 12, y: 22 },
    });
    client.destroy();
  });

  it("cancels pending movement when a direct identity change publishes it", () => {
    const { client, transport, users } = createTransportCursorClient({
      enabled: true,
      playerIdentity: makeIdentity("local", "#ff0000"),
    });
    transport.emit({ type: "presence-rate", channel: "cursor", hz: 5 });
    dispatchMouseMove(10, 20);
    vi.advanceTimersByTime(20);
    expect(transport.updates).toHaveLength(0);
    users.me.color = "#00ff00";
    expect(transport.updates).toHaveLength(1);
    vi.advanceTimersByTime(200);
    expect(transport.updates).toHaveLength(1);
    client.destroy();
  });

  it("stops publishing and receiving cursors after teardown", () => {
    const { client, transport } = createTransportCursorClient({
      enabled: true,
      playerIdentity: makeIdentity("local", "#ff0000"),
    });
    dispatchMouseMove(10, 20);
    client.destroy();
    const count = transport.updates.length;
    dispatchMouseMove(20, 30);
    transport.emit({
      type: "presence-sync",
      peers: {
        remote: {
          identity: makeIdentity("remote", "#00ff00"),
          cursor: {
            cursor: { x: 1, y: 2, pointer: "mouse" },
            page: "/",
            at: Date.now(),
          },
        },
      },
    });
    vi.advanceTimersByTime(500);
    expect(transport.updates).toHaveLength(count);
    expect(document.querySelector(".playhtml-cursor-other")).toBeNull();
    expect(transport.clears).toContain("cursor");
  });
});
