// ABOUTME: Tests runtime-message and direct-shortcut controls for injected inventory.
// ABOUTME: Verifies open, arm, validation, shortcut fallback, and listener cleanup behavior.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import browser from "webextension-polyfill";
import { registerInventoryMessages } from "../features/inventory/keyboard";

describe("registerInventoryMessages", () => {
  let listener!: (message: unknown) => void;

  beforeEach(() => {
    browser.runtime.onMessage.removeListener = vi.fn();
    vi.mocked(browser.runtime.onMessage.addListener).mockImplementation(
      ((next: (message: unknown) => void) => {
        listener = next;
      }) as typeof browser.runtime.onMessage.addListener,
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("routes valid open and arm messages", () => {
    const onOpen = vi.fn();
    const onArm = vi.fn();
    const cleanup = registerInventoryMessages({ onOpen, onArm });

    listener({ type: "wwo:open-inventory" });
    listener({ type: "wwo:arm-inventory", itemId: "scissors" });

    expect(onOpen).toHaveBeenCalledOnce();
    expect(onArm).toHaveBeenCalledWith("scissors");
    cleanup();
  });

  it("ignores malformed arm messages and unregisters on cleanup", () => {
    const onOpen = vi.fn();
    const onArm = vi.fn();
    const cleanup = registerInventoryMessages({ onOpen, onArm });

    listener({ type: "wwo:arm-inventory", itemId: 2 });
    listener({ type: "unrelated" });
    cleanup();

    expect(onOpen).not.toHaveBeenCalled();
    expect(onArm).not.toHaveBeenCalled();
    expect(browser.runtime.onMessage.removeListener).toHaveBeenCalledWith(
      listener,
    );
  });

  it("opens for Command or Control plus Shift and I", () => {
    const onOpen = vi.fn();
    const onArm = vi.fn();
    const cleanup = registerInventoryMessages({ onOpen, onArm });
    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "i",
        metaKey: true,
        shiftKey: true,
        bubbles: true,
      }),
    );

    expect(onOpen).toHaveBeenCalledOnce();
    expect(onArm).not.toHaveBeenCalled();
    cleanup();
  });
});
