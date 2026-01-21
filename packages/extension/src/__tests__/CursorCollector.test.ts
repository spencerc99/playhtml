import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { CursorCollector } from "../collectors/CursorCollector";
import type { CursorEventData } from "../collectors/types";
import {
  simulateMouseMove,
  simulateClick,
  simulateMouseDown,
  simulateMouseUp,
  createTestElement,
  advanceTime,
  waitForNextTick,
} from "./test-utils";

describe("CursorCollector", () => {
  let collector: CursorCollector;
  let emitCallback: ReturnType<typeof vi.fn>;
  let realTimeCallback: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    emitCallback = vi.fn();
    realTimeCallback = vi.fn();

    collector = new CursorCollector();
    collector.setEmitCallback(emitCallback);
    collector.setRealTimeCallback(realTimeCallback);

    // Set up document
    document.body.innerHTML = "";
  });

  afterEach(() => {
    collector.disable();
    vi.useRealTimers();
    document.body.innerHTML = "";
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
      const removeSpy = vi.spyOn(document, "removeEventListener");
      collector.enable();
      collector.disable();

      expect(removeSpy).toHaveBeenCalledWith(
        "mousemove",
        expect.any(Function)
      );
      expect(removeSpy).toHaveBeenCalledWith(
        "mousedown",
        expect.any(Function)
      );
      expect(removeSpy).toHaveBeenCalledWith(
        "mouseup",
        expect.any(Function)
      );

      removeSpy.mockRestore();
    });
  });

  describe("movement tracking", () => {
    it("emits move events when cursor moves beyond threshold", async () => {
      collector.enable();

      // Move cursor beyond threshold (15px)
      simulateMouseMove(0, 0);
      simulateMouseMove(20, 20);

      // Advance time past sample rate (250ms)
      await advanceTime(250);

      // Should emit move event
      expect(emitCallback).toHaveBeenCalled();
      const call = emitCallback.mock.calls[0][0] as CursorEventData;
      expect(call.x).toBeGreaterThan(0);
      expect(call.y).toBeGreaterThan(0);
      expect(call.event).toBe("move");
    });

    it("throttles movement sampling to 250ms", async () => {
      collector.enable();

      simulateMouseMove(0, 0);
      simulateMouseMove(20, 20);
      await advanceTime(100); // Less than sample rate

      expect(emitCallback).not.toHaveBeenCalled();

      await advanceTime(150); // Now past 250ms total

      expect(emitCallback).toHaveBeenCalledTimes(1);
    });

    it("does not emit if movement is below threshold", async () => {
      collector.enable();

      simulateMouseMove(0, 0);
      simulateMouseMove(5, 5); // Less than 15px threshold

      await advanceTime(250);

      // Should not emit because movement too small
      expect(emitCallback).not.toHaveBeenCalled();
    });

    it("tracks target element selector", async () => {
      collector.enable();

      const element = createTestElement("div", { id: "test-element" });
      simulateMouseMove(100, 100, element);

      await advanceTime(250);

      expect(emitCallback).toHaveBeenCalled();
      const call = emitCallback.mock.calls[0][0] as CursorEventData;
      expect(call.t).toBe("#test-element");
    });

    it("emits real-time updates at higher frequency", async () => {
      collector.enable();

      simulateMouseMove(100, 100);

      // Real-time updates should happen faster (16ms)
      await advanceTime(20);

      // Real-time callback should be called
      expect(realTimeCallback).toHaveBeenCalled();
    });
  });

  describe("click detection", () => {
    it("emits click event for quick mousedown/mouseup", async () => {
      collector.enable();

      const element = createTestElement("button", { id: "click-target" });
      await simulateClick(100, 100, 100, 0, element); // 100ms hold

      // Should emit click (not hold, since < 250ms)
      expect(emitCallback).toHaveBeenCalled();
      const call = emitCallback.mock.calls[0][0] as CursorEventData;
      expect(call.event).toBe("click");
      expect(call.button).toBe(0);
      expect(call.duration).toBeUndefined();
    });

    it("emits hold event for long mousedown/mouseup", async () => {
      collector.enable();

      const element = createTestElement("button", { id: "hold-target" });
      await simulateClick(100, 100, 300, 0, element); // 300ms hold

      // Should emit hold (>= 250ms)
      expect(emitCallback).toHaveBeenCalled();
      const call = emitCallback.mock.calls[0][0] as CursorEventData;
      expect(call.event).toBe("hold");
      expect(call.button).toBe(0);
      expect(call.duration).toBeGreaterThanOrEqual(250);
    });

    it("tracks button type (left, middle, right)", async () => {
      collector.enable();

      // Right click (button 2)
      simulateMouseDown(100, 100, 2);
      await advanceTime(100);
      simulateMouseUp(100, 100, 2);

      expect(emitCallback).toHaveBeenCalled();
      const call = emitCallback.mock.calls[0][0] as CursorEventData;
      expect(call.button).toBe(2);
    });

    it("normalizes click position to 0-1 range", async () => {
      collector.enable();

      // Click at (512, 384) in 1024x768 viewport = (0.5, 0.5)
      await simulateClick(512, 384, 100);

      expect(emitCallback).toHaveBeenCalled();
      const call = emitCallback.mock.calls[0][0] as CursorEventData;
      expect(call.x).toBeCloseTo(0.5, 2);
      expect(call.y).toBeCloseTo(0.5, 2);
    });
  });


  describe("cursor style detection", () => {
    it("detects cursor style changes", async () => {
      collector.enable();

      const pointerElement = createTestElement("a", {
        id: "link",
        cursor: "pointer",
      });
      const textElement = createTestElement("input", {
        id: "input",
        cursor: "text",
      });

      // Move to pointer element
      simulateMouseMove(100, 100, pointerElement);
      await advanceTime(20);

      // Move to text element (cursor changes)
      simulateMouseMove(200, 200, textElement);
      await advanceTime(20);

      // Should emit cursor_change event
      expect(emitCallback).toHaveBeenCalled();
      const calls = emitCallback.mock.calls;
      const cursorChangeCall = calls.find(
        (call) => (call[0] as CursorEventData).event === "cursor_change"
      );

      expect(cursorChangeCall).toBeDefined();
      if (cursorChangeCall) {
        const data = cursorChangeCall[0] as CursorEventData;
        expect(data.event).toBe("cursor_change");
        expect(data.cursor).toBe("text");
      }
    });

    it("includes cursor style in move events", async () => {
      collector.enable();

      const element = createTestElement("button", {
        id: "button",
        cursor: "pointer",
      });
      simulateMouseMove(100, 100, element);

      await advanceTime(250);

      expect(emitCallback).toHaveBeenCalled();
      const call = emitCallback.mock.calls[0][0] as CursorEventData;
      expect(call.cursor).toBe("pointer");
    });
  });

  describe("element selector generation", () => {
    it("prefers ID selector", async () => {
      collector.enable();

      const element = createTestElement("div", { id: "my-id" });
      simulateMouseMove(100, 100, element);

      await advanceTime(250);

      const call = emitCallback.mock.calls[0][0] as CursorEventData;
      expect(call.t).toBe("#my-id");
    });

    it("falls back to class selector", async () => {
      collector.enable();

      const element = createTestElement("div", { className: "my-class" });
      simulateMouseMove(100, 100, element);

      await advanceTime(250);

      const call = emitCallback.mock.calls[0][0] as CursorEventData;
      expect(call.t).toBe(".my-class");
    });

    it("falls back to tag name", async () => {
      collector.enable();

      const element = createTestElement("span");
      simulateMouseMove(100, 100, element);

      await advanceTime(250);

      const call = emitCallback.mock.calls[0][0] as CursorEventData;
      expect(call.t).toBe("span");
    });
  });

  describe("position normalization", () => {
    it("normalizes positions to 0-1 range", async () => {
      collector.enable();

      // Viewport is 1024x768 (from setup)
      simulateMouseMove(512, 384); // Center
      await advanceTime(250);

      const call = emitCallback.mock.calls[0][0] as CursorEventData;
      expect(call.x).toBeCloseTo(0.5, 2);
      expect(call.y).toBeCloseTo(0.5, 2);
    });

    it("clamps positions to 0-1", async () => {
      collector.enable();

      // Move to negative position (should clamp to 0)
      simulateMouseMove(-10, -10);
      await advanceTime(250);

      const call = emitCallback.mock.calls[0][0] as CursorEventData;
      expect(call.x).toBeGreaterThanOrEqual(0);
      expect(call.y).toBeGreaterThanOrEqual(0);
    });
  });

  describe("disabled state", () => {
    it("does not emit events when disabled", async () => {
      collector.enable();
      collector.disable();

      simulateMouseMove(100, 100);
      await simulateClick(100, 100, 100);

      expect(emitCallback).not.toHaveBeenCalled();
      expect(realTimeCallback).not.toHaveBeenCalled();
    });
  });
});
