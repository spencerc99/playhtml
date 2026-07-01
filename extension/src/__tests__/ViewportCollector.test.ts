// ABOUTME: Tests for ViewportCollector covering scroll, resize, and zoom event capture.
// ABOUTME: Validates throttling, debouncing, and normalized position data.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ViewportCollector } from "../collectors/ViewportCollector";
import type { ViewportEventData } from "../collectors/types";
import { simulateScroll, simulateResize, advanceTime } from "./test-utils";

describe("ViewportCollector", () => {
  let collector: ViewportCollector;
  let emitCallback: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    emitCallback = vi.fn();
    collector = new ViewportCollector();
    collector.setEmitCallback(emitCallback);

    // Reset scroll and viewport
    window.scrollX = 0;
    window.scrollY = 0;
    document.documentElement.scrollLeft = 0;
    document.documentElement.scrollTop = 0;
    // scrollWidth/scrollHeight are set in vitest.setup.ts — redefining here would throw
    Object.defineProperty(window, "innerWidth", {
      value: 1024,
      writable: true,
      configurable: true,
    });
    Object.defineProperty(window, "innerHeight", {
      value: 768,
      writable: true,
      configurable: true,
    });

    // Mock visualViewport
    Object.defineProperty(window, "visualViewport", {
      value: {
        scale: 1,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      },
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    collector.disable();
    vi.useRealTimers();
  });

  describe("enable/disable lifecycle", () => {
    it("starts collecting when enabled", () => {
      collector.enable();
      expect(collector.isEnabled()).toBe(true);
    });

    it("stops collecting when disabled", () => {
      collector.enable();
      collector.disable();
      expect(collector.isEnabled()).toBe(false);
    });

    it("removes event listeners when disabled", () => {
      const removeSpy = vi.spyOn(window, "removeEventListener");
      collector.enable();
      collector.disable();

      expect(removeSpy).toHaveBeenCalledWith("scroll", expect.any(Function));
      expect(removeSpy).toHaveBeenCalledWith("resize", expect.any(Function));

      removeSpy.mockRestore();
    });

    it("flushes pending scroll before disabling", async () => {
      collector.enable();

      simulateScroll(0, 100);
      await advanceTime(250);
      collector.disable();

      const scrollCalls = emitCallback.mock.calls.filter(
        (call) => (call[0] as ViewportEventData).event === "scroll"
      );
      expect(scrollCalls.length).toBe(1);
    });

    it("flushes pending zoom before disabling", async () => {
      collector.enable();

      Object.defineProperty(window, "visualViewport", {
        value: {
          scale: 1.5,
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
        },
        writable: true,
        configurable: true,
      });
      simulateResize(1024, 768);
      await advanceTime(500);
      collector.disable();

      const zoomCalls = emitCallback.mock.calls.filter(
        (call) => (call[0] as ViewportEventData).event === "zoom"
      );
      expect(zoomCalls.length).toBe(1);
      expect((zoomCalls[0][0] as ViewportEventData).zoom).toBe(1.5);
    });
  });

  describe("scroll events", () => {
    it("emits scroll events with normalized position", async () => {
      collector.enable();

      // Scroll to middle (scrollHeight = 2000, clientHeight = 768)
      // maxScrollY = 2000 - 768 = 1232
      // scrollY = 616 → normalized = 616 / 1232 ≈ 0.5
      simulateScroll(0, 616);

      await advanceTime(500); // Past throttle (500ms)

      expect(emitCallback).toHaveBeenCalledTimes(1);
      const call = emitCallback.mock.calls[0][0] as ViewportEventData;
      expect(call.event).toBe("scroll");
      expect(call.scrollX).toBeCloseTo(0, 2);
      expect(call.scrollY).toBeCloseTo(0.5, 2);
    });

    it("throttles scroll events to 500ms", async () => {
      collector.enable();

      simulateScroll(0, 100);
      await advanceTime(499); // Less than throttle

      expect(emitCallback).not.toHaveBeenCalled();

      simulateScroll(0, 200);
      await advanceTime(1); // Now past 500ms total

      expect(emitCallback).toHaveBeenCalledTimes(1);
    });

    it("normalizes scroll position to 0-1 range", async () => {
      collector.enable();

      // Scroll to top
      simulateScroll(0, 0);
      await advanceTime(500);

      let call = emitCallback.mock.calls[0][0] as ViewportEventData;
      expect(call.scrollY).toBe(0);

      // Scroll to bottom (max scroll)
      const maxScrollY = 2000 - 768; // 1232
      simulateScroll(0, maxScrollY);
      await advanceTime(500);

      call = emitCallback.mock.calls[1][0] as ViewportEventData;
      expect(call.scrollY).toBeCloseTo(1, 2);
    });

    it("handles horizontal scroll", async () => {
      collector.enable();

      // Set up horizontal scroll
      Object.defineProperty(document.documentElement, 'scrollWidth', { value: 2000, writable: true, configurable: true });
      simulateScroll(500, 0);

      await advanceTime(500);

      expect(emitCallback).toHaveBeenCalled();
      const call = emitCallback.mock.calls[0][0] as ViewportEventData;
      expect(call.scrollX).toBeGreaterThan(0);
    });

    it("clamps scroll position to 0-1", async () => {
      collector.enable();

      // Scroll beyond max (should clamp to 1)
      simulateScroll(0, 10000);
      await advanceTime(500);

      const call = emitCallback.mock.calls[0][0] as ViewportEventData;
      expect(call.scrollY).toBeLessThanOrEqual(1);
    });
  });

  describe("resize events", () => {
    it("emits resize events with new dimensions", async () => {
      collector.enable();

      simulateResize(1280, 1024);
      await advanceTime(1000); // Past debounce (1000ms)

      expect(emitCallback).toHaveBeenCalledTimes(1);
      const call = emitCallback.mock.calls[0][0] as ViewportEventData;
      expect(call.event).toBe("resize");
      expect(call.width).toBe(1280);
      expect(call.height).toBe(1024);
    });

    it("debounces resize events to 1000ms", async () => {
      collector.enable();

      simulateResize(1100, 800);
      await advanceTime(999); // Less than debounce

      expect(emitCallback).not.toHaveBeenCalled();

      simulateResize(1200, 900);
      await advanceTime(1000); // Complete the debounce from second resize

      // Should only emit once (debounced)
      expect(emitCallback).toHaveBeenCalledTimes(1);
    });

    it("cancels previous resize timer on new resize", async () => {
      collector.enable();

      simulateResize(1100, 800);
      await advanceTime(750); // Partway through debounce

      simulateResize(1200, 900); // New resize cancels previous
      await advanceTime(1000); // Complete new debounce

      // Should only emit once with latest dimensions
      expect(emitCallback).toHaveBeenCalledTimes(1);
      const call = emitCallback.mock.calls[0][0] as ViewportEventData;
      expect(call.width).toBe(1200);
      expect(call.height).toBe(900);
    });

    it("ignores tiny resize changes", async () => {
      collector.enable();

      simulateResize(1040, 790);
      await advanceTime(1000);

      expect(emitCallback).not.toHaveBeenCalled();
    });
  });

  describe("zoom detection", () => {
    it("detects zoom changes via visualViewport.scale", async () => {
      collector.enable();

      // Initial zoom is 1 (from setup)
      // Change zoom to 1.5
      Object.defineProperty(window, "visualViewport", {
        value: {
          scale: 1.5,
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
        },
        writable: true,
        configurable: true,
      });

      // Trigger resize (which checks zoom)
      simulateResize(1024, 768);
      await advanceTime(1000); // Wait for resize debounce (1000ms)

      expect(emitCallback).toHaveBeenCalled();
      const zoomCall = emitCallback.mock.calls.find(
        (call) => (call[0] as ViewportEventData).event === "zoom"
      );

      expect(zoomCall).toBeDefined();
      if (zoomCall) {
        const data = zoomCall[0] as ViewportEventData;
        expect(data.event).toBe("zoom");
        expect(data.zoom).toBe(1.5);
        expect(data.previous_zoom).toBe(1);
        expect(data.quantity).toBe(1); // Single zoom change
      }
    });

    it("does not emit zoom if level unchanged", async () => {
      collector.enable();

      // Zoom stays at 1
      simulateResize(1024, 768);
      await advanceTime(1000); // Wait for resize debounce (1000ms)

      // Should only emit resize, not zoom
      const zoomCalls = emitCallback.mock.calls.filter(
        (call) => (call[0] as ViewportEventData).event === "zoom"
      );
      expect(zoomCalls.length).toBe(0);
    });

    it("emits the settled zoom value after resize debounce", async () => {
      collector.enable();

      // First zoom: 1 -> 1.25
      Object.defineProperty(window, "visualViewport", {
        value: {
          scale: 1.25,
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
        },
        writable: true,
        configurable: true,
      });
      simulateResize(1024, 768);
      await advanceTime(500); // Still inside the resize debounce window

      expect(
        emitCallback.mock.calls.filter(
          (call) => (call[0] as ViewportEventData).event === "zoom"
        )
      ).toHaveLength(0);

      // Second zoom: 1.25 -> 1.5 before the debounce settles
      Object.defineProperty(window, "visualViewport", {
        value: {
          scale: 1.5,
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
        },
        writable: true,
        configurable: true,
      });
      simulateResize(1024, 768);
      await advanceTime(1000); // Wait for the final resize debounce

      let zoomCalls = emitCallback.mock.calls.filter(
        (call) => (call[0] as ViewportEventData).event === "zoom"
      );
      expect(zoomCalls.length).toBe(1);
      const settledZoom = zoomCalls[0][0] as ViewportEventData;
      expect(settledZoom.zoom).toBe(1.5);
      expect(settledZoom.previous_zoom).toBe(1);
      expect(settledZoom.quantity).toBe(2);
    });

    it("ignores zoom changes below five percent", async () => {
      collector.enable();

      Object.defineProperty(window, "visualViewport", {
        value: {
          scale: 1.04,
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
        },
        writable: true,
        configurable: true,
      });
      simulateResize(1024, 768);
      await advanceTime(1000);

      const zoomCalls = emitCallback.mock.calls.filter(
        (call) => (call[0] as ViewportEventData).event === "zoom"
      );
      expect(zoomCalls.length).toBe(0);
    });
  });

  describe("disabled state", () => {
    it("does not emit events when disabled", async () => {
      collector.enable();
      collector.disable();

      simulateScroll(0, 100);
      simulateResize(1280, 1024);

      await advanceTime(300);

      expect(emitCallback).not.toHaveBeenCalled();
    });
  });

  describe("multiple event types", () => {
    it("can handle scroll, resize, and zoom simultaneously", async () => {
      collector.enable();

      // Scroll
      simulateScroll(0, 100);
      await advanceTime(500);

      // Resize
      simulateResize(1280, 1024);
      await advanceTime(1000);

      // Zoom change
      Object.defineProperty(window, "visualViewport", {
        value: {
          scale: 1.5,
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
        },
        writable: true,
        configurable: true,
      });
      simulateResize(1280, 1024);
      await advanceTime(1000);

      expect(emitCallback).toHaveBeenCalled();
      const events = emitCallback.mock.calls.map(
        (call) => (call[0] as ViewportEventData).event
      );
      expect(events).toContain("scroll");
      expect(events).toContain("resize");
      expect(events).toContain("zoom");
    });
  });
});
