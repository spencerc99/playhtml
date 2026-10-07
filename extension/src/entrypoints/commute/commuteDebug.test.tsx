// ABOUTME: Verifies local Internet Commute debug panel activation.
// ABOUTME: Covers the admin query and archive-style double-D shortcut.

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hasCommuteAdminQuery, useCommuteDebug } from "./commuteDebug";

function DebugHarness({ search = "" }: { search?: string }) {
  const [visible] = useCommuteDebug(search);
  return <span>{visible ? "visible" : "hidden"}</span>;
}

describe("commute debug controls", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-12T12:00:00Z"));
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
  });

  it("opens directly when the admin query parameter is present", () => {
    expect(hasCommuteAdminQuery("?admin")).toBe(true);
    expect(hasCommuteAdminQuery("?admin=1&view=train")).toBe(true);
    expect(hasCommuteAdminQuery("?view=train")).toBe(false);

    act(() => root.render(<DebugHarness search="?admin" />));
    expect(container.textContent).toBe("visible");
  });

  it("toggles when D is pressed twice within 300 milliseconds", () => {
    act(() => root.render(<DebugHarness />));
    expect(container.textContent).toBe("hidden");

    act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "d" })));
    vi.advanceTimersByTime(100);
    act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "D" })));
    expect(container.textContent).toBe("visible");

    vi.advanceTimersByTime(100);
    act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "d" })));
    vi.advanceTimersByTime(100);
    act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "d" })));
    expect(container.textContent).toBe("hidden");
  });

  it("does not toggle while typing in a text field", () => {
    act(() => root.render(<DebugHarness />));
    const input = document.createElement("input");
    document.body.append(input);

    act(() => {
      input.dispatchEvent(
        new KeyboardEvent("keydown", { key: "d", bubbles: true }),
      );
      input.dispatchEvent(
        new KeyboardEvent("keydown", { key: "d", bubbles: true }),
      );
    });

    expect(container.textContent).toBe("hidden");
    input.remove();
  });
});
