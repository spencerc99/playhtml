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
    document.documentElement.scrollWidth = 1024;
    document.documentElement.scrollHeight = 2000;
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
  });

  describe("scroll events", () => {
    it("emits scroll events with normalized position", async () => {
      collector.enable();

      // Scroll to middle (scrollHeight = 2000, clientHeight = 768)
      // maxScrollY = 2000 - 768 = 1232
      // scrollY = 616 → normalized = 616 / 1232 ≈ 0.5
      simulateScroll(0, 616);

      await advanceTime(100); // Past throttle (100ms)

      expect(emitCallback).toHaveBeenCalledTimes(1);
      const call = emitCallback.mock.calls[0][0] as ViewportEventData;
      expect(call.event).toBe("scroll");
      expect(call.scrollX).toBeCloseTo(0, 2);
      expect(call.scrollY).toBeCloseTo(0.5, 2);
    });

    it("throttles scroll events to 100ms", async () => {
      collector.enable();

      simulateScroll(0, 100);
      await advanceTime(50); // Less than throttle

      expect(emitCallback).not.toHaveBeenCalled();

      simulateScroll(0, 200);
      await advanceTime(60); // Now past 100ms total

      expect(emitCallback).toHaveBeenCalledTimes(1);
    });

    it("normalizes scroll position to 0-1 range", async () => {
      collector.enable();

      // Scroll to top
      simulateScroll(0, 0);
      await advanceTime(100);

      let call = emitCallback.mock.calls[0][0] as ViewportEventData;
      expect(call.scrollY).toBe(0);

      // Scroll to bottom (max scroll)
      const maxScrollY = 2000 - 768; // 1232
      simulateScroll(0, maxScrollY);
      await advanceTime(100);

      call = emitCallback.mock.calls[1][0] as ViewportEventData;
      expect(call.scrollY).toBeCloseTo(1, 2);
    });

    it("handles horizontal scroll", async () => {
      collector.enable();

      // Set up horizontal scroll
      document.documentElement.scrollWidth = 2000;
      simulateScroll(500, 0);

      await advanceTime(100);

      expect(emitCallback).toHaveBeenCalled();
      const call = emitCallback.mock.calls[0][0] as ViewportEventData;
      expect(call.scrollX).toBeGreaterThan(0);
    });

    it("clamps scroll position to 0-1", async () => {
      collector.enable();

      // Scroll beyond max (should clamp to 1)
      simulateScroll(0, 10000);
      await advanceTime(100);

      const call = emitCallback.mock.calls[0][0] as ViewportEventData;
      expect(call.scrollY).toBeLessThanOrEqual(1);
    });
  });

  describe("resize events", () => {
    it("emits resize events with new dimensions", async () => {
      collector.enable();

      simulateResize(1280, 1024);
      await advanceTime(200); // Past debounce (200ms)

      expect(emitCallback).toHaveBeenCalledTimes(1);
      const call = emitCallback.mock.calls[0][0] as ViewportEventData;
      expect(call.event).toBe("resize");
      expect(call.width).toBe(1280);
      expect(call.height).toBe(1024);
    });

    it("debounces resize events to 200ms", async () => {
      collector.enable();

      simulateResize(1100, 800);
      await advanceTime(100); // Less than debounce

      expect(emitCallback).not.toHaveBeenCalled();

      simulateResize(1200, 900);
      await advanceTime(110); // Now past 200ms total

      // Should only emit once (debounced)
      expect(emitCallback).toHaveBeenCalledTimes(1);
    });

    it("cancels previous resize timer on new resize", async () => {
      collector.enable();

      simulateResize(1100, 800);
      await advanceTime(150); // Partway through debounce

      simulateResize(1200, 900); // New resize cancels previous
      await advanceTime(200); // Complete new debounce

      // Should only emit once with latest dimensions
      expect(emitCallback).toHaveBeenCalledTimes(1);
      const call = emitCallback.mock.calls[0][0] as ViewportEventData;
      expect(call.width).toBe(1200);
      expect(call.height).toBe(900);
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
      await advanceTime(2000); // Wait for resize debounce

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
      await advanceTime(2000); // Wait for resize debounce

      // Should only emit resize, not zoom
      const zoomCalls = emitCallback.mock.calls.filter(
        (call) => (call[0] as ViewportEventData).event === "zoom"
      );
      expect(zoomCalls.length).toBe(0);
    });

    it("debounces rapid zoom changes within 2 seconds and tracks quantity", async () => {
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
      await advanceTime(2000); // Wait for resize debounce

      // Should emit first zoom
      let zoomCalls = emitCallback.mock.calls.filter(
        (call) => (call[0] as ViewportEventData).event === "zoom"
      );
      expect(zoomCalls.length).toBe(1);
      expect((zoomCalls[0][0] as ViewportEventData).quantity).toBe(1);

      // Second zoom: 1.25 -> 1.5 (within 500ms - should increment quantity)
      await advanceTime(300); // Total 300ms since first zoom
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
      await advanceTime(2000); // Wait for resize debounce

      // Third zoom: 1.5 -> 1.75 (within 2s window - should still increment)
      await advanceTime(300);
      Object.defineProperty(window, "visualViewport", {
        value: {
          scale: 1.75,
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
        },
        writable: true,
        configurable: true,
      });
      simulateResize(1024, 768);
      await advanceTime(2000);

      // Still only 1 zoom event (within debounce window)
      zoomCalls = emitCallback.mock.calls.filter(
        (call) => (call[0] as ViewportEventData).event === "zoom"
      );
      expect(zoomCalls.length).toBe(1);

      // Fourth zoom: 1.75 -> 2.0 (after 2600ms total - should emit new event)
      await advanceTime(600); // Total 2600ms since first zoom
      Object.defineProperty(window, "visualViewport", {
        value: {
          scale: 2.0,
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
        },
        writable: true,
        configurable: true,
      });
      simulateResize(1024, 768);
      await advanceTime(2000); // Wait for resize debounce

      // Should now have 2 zoom events
      zoomCalls = emitCallback.mock.calls.filter(
        (call) => (call[0] as ViewportEventData).event === "zoom"
      );
      expect(zoomCalls.length).toBe(2);

      // Check the second zoom event has previous_zoom and quantity
      const secondZoom = zoomCalls[1][0] as ViewportEventData;
      expect(secondZoom.zoom).toBe(2.0);
      expect(secondZoom.previous_zoom).toBe(1.75);
      expect(secondZoom.quantity).toBe(1); // New debounce window
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
      await advanceTime(100);

      // Resize
      simulateResize(1280, 1024);
      await advanceTime(200);

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
      await advanceTime(200);

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
