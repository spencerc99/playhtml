// ABOUTME: Tests for the embedded-frame activity relay.
// ABOUTME: Covers throttled input reports and periodic reports while media plays.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  FRAME_ACTIVITY_THROTTLE_MS,
  startFrameActivityRelay,
} from "../features/frameActivity";

describe("startFrameActivityRelay", () => {
  let report: ReturnType<typeof vi.fn>;
  let stop: () => void;

  beforeEach(() => {
    vi.useFakeTimers();
    report = vi.fn();
    stop = startFrameActivityRelay(report);
  });

  afterEach(() => {
    stop();
    document.body.innerHTML = "";
    vi.useRealTimers();
  });

  it("reports input at most once per throttle window", () => {
    window.dispatchEvent(new Event("pointermove"));
    window.dispatchEvent(new Event("keydown"));
    expect(report).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(FRAME_ACTIVITY_THROTTLE_MS);
    window.dispatchEvent(new Event("wheel"));
    expect(report).toHaveBeenCalledTimes(2);
  });

  it("keeps reporting while media plays and stops when it pauses", () => {
    const video = document.createElement("video");
    Object.defineProperty(video, "paused", { value: false, writable: true });
    Object.defineProperty(video, "ended", { value: false });
    Object.defineProperty(video, "readyState", { value: 4 });
    document.body.appendChild(video);

    video.dispatchEvent(new Event("playing"));
    expect(report).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(FRAME_ACTIVITY_THROTTLE_MS * 4);
    expect(report).toHaveBeenCalledTimes(5);

    (video as { paused: boolean }).paused = true;
    vi.advanceTimersByTime(FRAME_ACTIVITY_THROTTLE_MS * 4);
    expect(report).toHaveBeenCalledTimes(5);
  });

  it("stops listening after cleanup", () => {
    stop();
    window.dispatchEvent(new Event("pointerdown"));
    expect(report).not.toHaveBeenCalled();
  });
});
