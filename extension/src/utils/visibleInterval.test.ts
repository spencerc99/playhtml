// ABOUTME: Verifies refresh intervals pause while the page is hidden.
// ABOUTME: Covers hidden start, refresh-on-return, and cleanup.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startVisibleInterval } from "./visibleInterval";

let hidden = false;

function setHidden(value: boolean) {
  hidden = value;
  document.dispatchEvent(new Event("visibilitychange"));
}

describe("startVisibleInterval", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    hidden = false;
    vi.spyOn(document, "hidden", "get").mockImplementation(() => hidden);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("refreshes on the interval while visible and pauses while hidden", () => {
    const refresh = vi.fn();
    const stop = startVisibleInterval(refresh, 30_000);

    vi.advanceTimersByTime(60_000);
    expect(refresh).toHaveBeenCalledTimes(2);

    setHidden(true);
    vi.advanceTimersByTime(300_000);
    expect(refresh).toHaveBeenCalledTimes(2);

    setHidden(false);
    expect(refresh).toHaveBeenCalledTimes(3);
    vi.advanceTimersByTime(30_000);
    expect(refresh).toHaveBeenCalledTimes(4);
    stop();
  });

  it("waits for the page to become visible when it starts hidden", () => {
    hidden = true;
    const refresh = vi.fn();
    const stop = startVisibleInterval(refresh, 30_000);

    vi.advanceTimersByTime(120_000);
    expect(refresh).not.toHaveBeenCalled();

    setHidden(false);
    expect(refresh).toHaveBeenCalledTimes(1);
    stop();
  });

  it("does not refresh again for a visibility event while already visible", () => {
    const refresh = vi.fn();
    const stop = startVisibleInterval(refresh, 30_000);
    setHidden(false);
    expect(refresh).not.toHaveBeenCalled();
    stop();
  });

  it("stops refreshing after cleanup", () => {
    const refresh = vi.fn();
    const stop = startVisibleInterval(refresh, 30_000);
    stop();

    vi.advanceTimersByTime(60_000);
    setHidden(true);
    setHidden(false);
    expect(refresh).not.toHaveBeenCalled();
  });
});
