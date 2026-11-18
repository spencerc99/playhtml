// ABOUTME: Verifies the cursor client keeps the page's root cursor style on pointer moves.
// ABOUTME: Covers a page that overrides and then clears the root cursor itself.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTransportCursorClient } from "../../__tests__/presence-test-utils";

const identity = {
  publicKey: "local-key",
  playerStyle: { colorPalette: ["#111111"] },
} as any;

function moveTo(clientX: number, clientY: number) {
  document.dispatchEvent(
    new MouseEvent("mousemove", { clientX, clientY, bubbles: true }),
  );
  vi.advanceTimersByTime(Math.ceil(1000 / 60));
}

describe("root cursor style", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = "";
    document.documentElement.style.cursor = "";
    Object.defineProperty(document, "elementFromPoint", {
      configurable: true,
      value: vi.fn(() => document.body),
    });
  });

  afterEach(() => {
    document.documentElement.style.cursor = "";
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("restores its cursor on the next pointer move after the page clears it", () => {
    const { client } = createTransportCursorClient({
      enabled: true,
      playerIdentity: identity,
    });
    moveTo(10, 10);
    const ownCursor = document.documentElement.style.cursor;
    expect(ownCursor).toContain("data:image/svg+xml");

    // The page hides the cursor during a drag, then clears its override.
    document.documentElement.style.cursor = "none";
    document.documentElement.style.cursor = "";

    moveTo(20, 20);
    expect(document.documentElement.style.cursor).toBe(ownCursor);

    client.destroy();
  });
});
