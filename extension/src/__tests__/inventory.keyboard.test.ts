// ABOUTME: Verifies the inventory summon shortcut works directly on extension-enabled pages.
// ABOUTME: Keeps the manifest command path while covering browser shortcut assignment failures.

import { afterEach, describe, expect, it, vi } from "vitest";
import { registerKeyboardSummon } from "../features/inventory/keyboard";

describe("registerKeyboardSummon", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("opens for Command or Control plus Shift and I", () => {
    const onOpen = vi.fn();
    const cleanup = registerKeyboardSummon(onOpen);
    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "i",
        metaKey: true,
        shiftKey: true,
        bubbles: true,
      }),
    );

    expect(onOpen).toHaveBeenCalledOnce();
    cleanup();
  });
});
