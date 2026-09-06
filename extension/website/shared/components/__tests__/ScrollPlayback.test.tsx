// ABOUTME: Exercises the scrolling renderer with a controlled animation-frame clock.
// ABOUTME: Verifies timing, completion, introduction cadence, capacity, and speed changes.

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AnimatedScrollViewports } from "../AnimatedScrollViewports";
import type { ScrollAnimation } from "../../types";

const animation: ScrollAnimation = {
  participantId: "person",
  sessionId: "session",
  pageUrl: "https://example.com",
  color: "#123456",
  startTime: 1000,
  endTime: 41000,
  startViewportWidth: 1200,
  startViewportHeight: 800,
  endViewportWidth: 1200,
  endViewportHeight: 800,
  scrollEvents: [0, 0.25, 1].map((scrollY) => ({
    scrollX: 0,
    scrollY,
    timestamp: 1000 + scrollY * 40000,
    viewportWidth: 1200,
    viewportHeight: 800,
  })),
};

describe("scroll playback", () => {
  let root: Root;
  let container: HTMLDivElement;
  let frame: FrameRequestCallback;
  let now: number;
  let logs: ReturnType<typeof vi.spyOn>;
  const settings = {
    scrollSpeed: 1,
    backgroundOpacity: 0.7,
    maxConcurrentScrolls: 2,
    allowOverlap: true,
    showTitleBar: false,
  };

  beforeEach(() => {
    (
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    root = createRoot(container);
    now = 0;
    vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation(
      (callback) => {
        frame = callback;
        return 1;
      },
    );
    vi.spyOn(globalThis, "cancelAnimationFrame").mockImplementation(() => {});
    logs = vi.spyOn(console, "log").mockImplementation(() => {});
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    expect(
      logs.mock.calls.every(([message]) =>
        /^\[Scroll Dynamic\] (Initialized queue|Added viewport|Removed viewport)/.test(
          String(message),
        ),
      ),
    ).toBe(true);
    vi.restoreAllMocks();
  });
  async function tick(milliseconds: number) {
    now += milliseconds;
    await act(async () => frame(now));
  }
  async function render(
    speed: number,
    animations = [animation],
    complete = () => true,
  ) {
    await act(async () =>
      root.render(
        <AnimatedScrollViewports
          animations={animations}
          canvasSize={{ width: 1200, height: 800 }}
          repeatAnimations={false}
          onAnimationsComplete={complete}
          settings={{ ...settings, scrollSpeed: speed }}
        />,
      ),
    );
  }
  function windows() {
    return container.querySelectorAll('clipPath[id^="viewport-clip-"]');
  }
  function scrollPosition() {
    const group = windows()[0].parentElement!.parentElement!;
    const rectangles = group.querySelectorAll(":scope > rect");
    const track = rectangles[rectangles.length - 2];
    const thumb = rectangles[rectangles.length - 1];
    return (
      (Number(thumb.getAttribute("y")) - Number(track.getAttribute("y"))) /
      (Number(track.getAttribute("height")) -
        Number(thumb.getAttribute("height")))
    );
  }

  it.each([0.5, 1, 4, 10])(
    "plays all recorded motion and completes at %sx",
    async (speed) => {
      let completions = 0;
      await render(speed, [animation], () => {
        completions++;
        return true;
      });
      await tick(0);
      await tick(300 / speed);
      await tick(400 / speed);
      await tick(10000 / speed);
      expect(scrollPosition()).toBeCloseTo(0.25);
      expect(completions).toBe(0);
      await tick(30000 / speed);
      expect(windows()).toHaveLength(1);
      expect(scrollPosition()).toBeCloseTo(1);
      await tick(300 / speed);
      await tick(600 / speed);
      expect(windows()).toHaveLength(0);
      await tick(300 / speed);
      expect(completions).toBe(1);
    },
  );

  it.each([0.5, 1, 4, 10])(
    "scales introduction cadence at %sx while respecting Max Windows",
    async (speed) => {
      await render(speed, [animation, animation, animation]);
      await tick(0);
      await tick(299 / speed);
      expect(windows()).toHaveLength(0);
      await tick(1 / speed);
      expect(windows()).toHaveLength(1);
      await tick(300 / speed);
      expect(windows()).toHaveLength(2);
      await tick(300 / speed);
      expect(windows()).toHaveLength(2);
    },
  );

  it("continues from the current position when speed changes", async () => {
    const animations = [animation];
    await render(1, animations);
    await tick(0);
    await tick(300);
    await tick(400);
    await tick(10000);
    expect(scrollPosition()).toBeCloseTo(0.25);
    await render(4, animations);
    await tick(1000);
    expect(scrollPosition()).toBeCloseTo(0.35);
  });
});
