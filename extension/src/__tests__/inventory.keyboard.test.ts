// ABOUTME: Tests runtime-message controls for opening and arming the injected inventory.
// ABOUTME: Verifies message validation and listener cleanup at the extension boundary.

import { beforeEach, describe, expect, it, vi } from "vitest";
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

  it("routes valid open and arm messages", () => {
    const onOpen = vi.fn();
    const onArm = vi.fn();
    registerInventoryMessages({ onOpen, onArm });

    listener({ type: "wwo:open-inventory" });
    listener({ type: "wwo:arm-inventory", itemId: "scissors" });

    expect(onOpen).toHaveBeenCalledOnce();
    expect(onArm).toHaveBeenCalledWith("scissors");
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
});
