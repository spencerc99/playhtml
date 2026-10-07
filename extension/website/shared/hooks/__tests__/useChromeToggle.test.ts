// ABOUTME: Tests the shared double-d chrome visibility toggle.
// ABOUTME: Verifies pages can start hidden while retaining the keyboard toggle.

// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it } from "vitest";
import { useChromeToggle } from "../useChromeToggle";

async function renderChromeToggle(initiallyHidden: boolean) {
  const container = document.createElement("div");
  const root = createRoot(container);
  const renderedValues: boolean[] = [];

  function HookHarness() {
    renderedValues.push(useChromeToggle(initiallyHidden));
    return null;
  }

  await act(async () => {
    root.render(createElement(HookHarness));
  });

  return {
    currentValue: () => renderedValues.at(-1),
    unmount: async () => {
      await act(async () => root.unmount());
    },
  };
}

describe("useChromeToggle", () => {
  beforeEach(() => {
    (
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
  });

  it("uses the requested initial visibility", async () => {
    const rendered = await renderChromeToggle(true);

    expect(rendered.currentValue()).toBe(true);
    await rendered.unmount();
  });

  it("toggles after two d key presses", async () => {
    const rendered = await renderChromeToggle(true);

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "d" }));
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "d" }));
    });

    expect(rendered.currentValue()).toBe(false);
    await rendered.unmount();
  });
});
