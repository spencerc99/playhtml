// ABOUTME: Verifies cursor render filters reevaluate current remote presences.
// ABOUTME: Predicate changes apply without waiting for another peer update.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createFakePresenceTransport,
  createTransportCursorClient,
  type FakePresenceTransport,
} from "../../__tests__/presence-test-utils";

function addRemoteCursor(transport: FakePresenceTransport) {
  transport.emit({
    type: "presence-sync",
    peers: {
      remote: {
        identity: {
          publicKey: "remote-key",
          playerStyle: { colorPalette: ["#00ff00"] },
        },
        cursor: {
          cursor: { x: 10, y: 20, pointer: "default" },
          page: "/",
          at: Date.now(),
        },
      },
    },
  } as any);
}

function makeClient(
  transport: FakePresenceTransport,
  shouldRenderCursor?: () => boolean,
) {
  return createTransportCursorClient(
    {
      enabled: true,
      playerIdentity: {
        publicKey: "local-key",
        playerStyle: { colorPalette: ["#ff0000"] },
      } as any,
      shouldRenderCursor,
    },
    transport,
  ).client;
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
    const transport = createFakePresenceTransport();
    const client = makeClient(transport);
    addRemoteCursor(transport);

    const cursor = document.querySelector(".playhtml-cursor-other");
    expect(cursor).not.toBeNull();

    client.configure({ shouldRenderCursor: () => false });

    expect(cursor?.classList.contains("playhtml-cursor-fade-out")).toBe(true);
    vi.advanceTimersByTime(300);
    expect(document.querySelector(".playhtml-cursor-other")).toBeNull();

    client.destroy();
  });

  it("renders a previously filtered cursor without another peer update", () => {
    const transport = createFakePresenceTransport();
    const client = makeClient(transport, () => false);
    addRemoteCursor(transport);

    expect(document.querySelector(".playhtml-cursor-other")).toBeNull();

    client.configure({ shouldRenderCursor: () => true });

    expect(document.querySelector(".playhtml-cursor-other")).not.toBeNull();

    client.destroy();
  });

  it("renders a filtered cursor when the filter is cleared", () => {
    const transport = createFakePresenceTransport();
    const client = makeClient(transport, () => false);
    addRemoteCursor(transport);

    expect(document.querySelector(".playhtml-cursor-other")).toBeNull();

    client.configure({ shouldRenderCursor: undefined });

    expect(document.querySelector(".playhtml-cursor-other")).not.toBeNull();

    client.destroy();
  });
});
