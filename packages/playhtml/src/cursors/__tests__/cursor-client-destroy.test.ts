// ABOUTME: Verifies CursorClientAwareness.destroy() releases page-global state.
// ABOUTME: Covers window.cursors and the root cursor style, without clobbering newer owners.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTransportCursorClient } from "../../__tests__/presence-test-utils";

const identity = {
  publicKey: "local-key",
  playerStyle: { colorPalette: ["#111111"] },
} as any;

describe("CursorClientAwareness.destroy", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    document.documentElement.style.cursor = "";
    delete window.cursors;
  });

  afterEach(() => {
    document.documentElement.style.cursor = "";
    delete window.cursors;
  });

  it("removes its window.cursors and restores the page cursor", () => {
    document.documentElement.style.cursor = "crosshair";
    const { client } = createTransportCursorClient({
      enabled: true,
      playerIdentity: identity,
    });

    expect(window.cursors).toBeDefined();
    expect(document.documentElement.style.cursor).not.toBe("crosshair");
    expect(document.documentElement.style.cursor).toContain(
      "data:image/svg+xml",
    );

    client.destroy();

    expect(window.cursors).toBeUndefined();
    expect(document.documentElement.style.cursor).toBe("crosshair");
  });

  it("leaves a newer client's window.cursors and cursor style in place", () => {
    const { client: first } = createTransportCursorClient({
      enabled: true,
      playerIdentity: identity,
    });
    const { client: second } = createTransportCursorClient({
      enabled: true,
      playerIdentity: {
        publicKey: "other-key",
        playerStyle: { colorPalette: ["#222222"] },
      } as any,
    });
    const secondApi = window.cursors;
    const secondCursor = document.documentElement.style.cursor;

    first.destroy();

    expect(window.cursors).toBe(secondApi);
    expect(document.documentElement.style.cursor).toBe(secondCursor);
    second.destroy();
    expect(window.cursors).toBeUndefined();
  });

  it("leaves a cursor style the page set after the client started", () => {
    const { client } = createTransportCursorClient({
      enabled: true,
      playerIdentity: identity,
    });
    document.documentElement.style.cursor = "wait";

    client.destroy();

    expect(document.documentElement.style.cursor).toBe("wait");
  });
});
