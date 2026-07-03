// ABOUTME: Tests for KeyboardCollector privacy and emission behavior.
// ABOUTME: Ensures captured typing stays inside the extension collector pipeline.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import browser from "webextension-polyfill";
import { KeyboardCollector } from "../collectors/KeyboardCollector";
import type { KeyboardEventData } from "../collectors/types";

describe("KeyboardCollector", () => {
  let storageChangeListener: {
    addListener: ReturnType<typeof vi.fn>;
    removeListener: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.useFakeTimers();
    storageChangeListener = {
      addListener: vi.fn(),
      removeListener: vi.fn(),
    };
    (browser.storage as any).onChanged = storageChangeListener;
    document.body.innerHTML = "";
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("emits typing data without posting it to the page window", async () => {
    const collector = new KeyboardCollector();
    const emitted: KeyboardEventData[] = [];
    collector.setEmitCallback((event) => {
      emitted.push(event);
    });
    const postMessageSpy = vi.spyOn(window, "postMessage");
    vi.spyOn(window, "getComputedStyle").mockReturnValue({
      backgroundColor: "rgb(255, 255, 255)",
      borderStyle: "solid",
      borderTopLeftRadius: "4px",
    } as CSSStyleDeclaration);

    const input = document.createElement("input");
    input.id = "message";
    input.getBoundingClientRect = () =>
      ({
        left: 10,
        top: 20,
        width: 200,
        height: 40,
        right: 210,
        bottom: 60,
        x: 10,
        y: 20,
        toJSON: () => ({}),
      }) as DOMRect;
    document.body.appendChild(input);

    collector.enable();
    input.dispatchEvent(new FocusEvent("focus", { bubbles: true }));
    input.value = "h";
    input.dispatchEvent(
      new InputEvent("input", {
        bubbles: true,
        inputType: "insertText",
        data: "h",
      }),
    );

    await vi.advanceTimersByTimeAsync(5_000);

    expect(emitted).toHaveLength(1);
    expect(postMessageSpy).not.toHaveBeenCalled();

    collector.disable();
  });

  it("removes storage change listeners when disabled", () => {
    const collector = new KeyboardCollector();

    collector.enable();
    expect(storageChangeListener.addListener).toHaveBeenCalledTimes(1);
    const firstHandler = storageChangeListener.addListener.mock.calls[0][0];

    collector.disable();
    expect(storageChangeListener.removeListener).toHaveBeenCalledWith(firstHandler);

    collector.enable();
    expect(storageChangeListener.addListener).toHaveBeenCalledTimes(2);
    const secondHandler = storageChangeListener.addListener.mock.calls[1][0];

    collector.disable();
    expect(storageChangeListener.removeListener).toHaveBeenCalledWith(secondHandler);
    expect(storageChangeListener.removeListener).toHaveBeenCalledTimes(2);
  });
});
