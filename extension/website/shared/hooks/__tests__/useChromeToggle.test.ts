// ABOUTME: Tests the shared double-d chrome visibility toggle.
// ABOUTME: Verifies pages can start hidden while retaining the keyboard toggle.

// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useChromeToggle } from "../useChromeToggle";

describe("useChromeToggle", () => {
  it("uses the requested initial visibility", () => {
    const { result } = renderHook(() => useChromeToggle(true));

    expect(result.current).toBe(true);
  });

  it("toggles after two d key presses", () => {
    const { result } = renderHook(() => useChromeToggle(true));

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "d" }));
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "d" }));
    });

    expect(result.current).toBe(false);
  });
});
