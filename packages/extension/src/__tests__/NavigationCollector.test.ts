import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NavigationCollector } from "../collectors/NavigationCollector";
import type { NavigationEventData } from "../collectors/types";

describe("NavigationCollector", () => {
  let collector: NavigationCollector;
  let emitCallback: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    emitCallback = vi.fn();
    collector = new NavigationCollector();
    collector.setEmitCallback(emitCallback);

    // Mock window.location
    Object.defineProperty(window, "location", {
      value: {
        href: "https://example.com/page",
        pathname: "/page",
        search: "",
        hash: "",
      },
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    collector.disable();
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
      const docRemoveSpy = vi.spyOn(document, "removeEventListener");
      const winRemoveSpy = vi.spyOn(window, "removeEventListener");
      collector.enable();
      collector.disable();

      expect(docRemoveSpy).toHaveBeenCalledWith("visibilitychange", expect.any(Function));
      expect(winRemoveSpy).toHaveBeenCalledWith("popstate", expect.any(Function));
      expect(winRemoveSpy).toHaveBeenCalledWith(
        "beforeunload",
        expect.any(Function)
      );

      docRemoveSpy.mockRestore();
      winRemoveSpy.mockRestore();
    });
  });

  describe("visibility change (tab switching)", () => {
    beforeEach(() => {
      // Mock document.hidden and visibilityState
      Object.defineProperty(document, "hidden", {
        writable: true,
        configurable: true,
        value: false,
      });
      Object.defineProperty(document, "visibilityState", {
        writable: true,
        configurable: true,
        value: "visible",
      });
    });

    it("emits blur event when tab becomes hidden", () => {
      collector.enable();

      // Simulate tab switch away
      Object.defineProperty(document, "hidden", { value: true });
      Object.defineProperty(document, "visibilityState", { value: "hidden" });
      
      const visibilityEvent = new Event("visibilitychange", { bubbles: true });
      document.dispatchEvent(visibilityEvent);

      expect(emitCallback).toHaveBeenCalledTimes(1);
      const call = emitCallback.mock.calls[0][0] as NavigationEventData;
      expect(call.event).toBe("blur");
      expect(call.visibility_state).toBe("hidden");
    });

    it("emits focus event when tab becomes visible", () => {
      collector.enable();

      // Simulate tab switch back
      Object.defineProperty(document, "hidden", { value: false });
      Object.defineProperty(document, "visibilityState", { value: "visible" });
      
      const visibilityEvent = new Event("visibilitychange", { bubbles: true });
      document.dispatchEvent(visibilityEvent);

      expect(emitCallback).toHaveBeenCalledTimes(1);
      const call = emitCallback.mock.calls[0][0] as NavigationEventData;
      expect(call.event).toBe("focus");
      expect(call.visibility_state).toBe("visible");
    });

    it("deduplicates events within 2 second window", () => {
      vi.useFakeTimers();
      collector.enable();

      // First blur
      Object.defineProperty(document, "hidden", { value: true });
      document.dispatchEvent(new Event("visibilitychange"));
      expect(emitCallback).toHaveBeenCalledTimes(1);
      expect((emitCallback.mock.calls[0][0] as NavigationEventData).quantity).toBe(1);

      // Second blur within 500ms - should be ignored
      vi.advanceTimersByTime(500);
      document.dispatchEvent(new Event("visibilitychange"));
      expect(emitCallback).toHaveBeenCalledTimes(1); // Still 1

      // Third blur after 2100ms - should emit
      vi.advanceTimersByTime(1600);
      document.dispatchEvent(new Event("visibilitychange"));
      expect(emitCallback).toHaveBeenCalledTimes(2);
      expect((emitCallback.mock.calls[1][0] as NavigationEventData).quantity).toBe(1);

      vi.useRealTimers();
    });

    it("does not emit when disabled", () => {
      collector.enable();
      collector.disable();

      const visibilityEvent = new Event("visibilitychange", { bubbles: true });
      document.dispatchEvent(visibilityEvent);

      expect(emitCallback).not.toHaveBeenCalled();
    });
  });

  describe("popstate event", () => {
    it("emits popstate event with URL and state", () => {
      collector.enable();

      const mockState = { page: 2, filter: "active" };
      const popstateEvent = new PopStateEvent("popstate", {
        state: mockState,
      });

      // Update location before event
      Object.defineProperty(window, "location", {
        value: {
          href: "https://example.com/page?page=2",
          pathname: "/page",
          search: "?page=2",
          hash: "",
        },
        writable: true,
        configurable: true,
      });

      window.dispatchEvent(popstateEvent);

      expect(emitCallback).toHaveBeenCalledTimes(1);
      const call = emitCallback.mock.calls[0][0] as NavigationEventData;
      expect(call.event).toBe("popstate");
      expect(call.url).toBe("https://example.com/page?page=2");
      expect(call.state).toEqual(mockState);
    });

    it("handles popstate without state", () => {
      collector.enable();

      const popstateEvent = new PopStateEvent("popstate", { state: null });
      window.dispatchEvent(popstateEvent);

      expect(emitCallback).toHaveBeenCalledTimes(1);
      const call = emitCallback.mock.calls[0][0] as NavigationEventData;
      expect(call.event).toBe("popstate");
      expect(call.state).toBeNull();
    });
  });

  describe("beforeunload event", () => {
    it("emits beforeunload event with from_url", () => {
      collector.enable();

      const beforeunloadEvent = new BeforeUnloadEvent("beforeunload", {
        cancelable: true,
      });

      window.dispatchEvent(beforeunloadEvent);

      expect(emitCallback).toHaveBeenCalledTimes(1);
      const call = emitCallback.mock.calls[0][0] as NavigationEventData;
      expect(call.event).toBe("beforeunload");
      expect(call.from_url).toBe("https://example.com/page");
    });
  });

  describe("multiple events", () => {
    it("can handle multiple events in sequence", () => {
      collector.enable();

      window.dispatchEvent(new Event("focus"));
      window.dispatchEvent(new Event("blur"));
      window.dispatchEvent(new Event("focus"));

      expect(emitCallback).toHaveBeenCalledTimes(3);
      expect(emitCallback.mock.calls[0][0].event).toBe("focus");
      expect(emitCallback.mock.calls[1][0].event).toBe("blur");
      expect(emitCallback.mock.calls[2][0].event).toBe("focus");
    });
  });

  describe("disabled state", () => {
    it("does not emit events when disabled", () => {
      collector.enable();
      collector.disable();

      window.dispatchEvent(new Event("focus"));
      window.dispatchEvent(new Event("blur"));
      window.dispatchEvent(new PopStateEvent("popstate", { state: null }));

      expect(emitCallback).not.toHaveBeenCalled();
    });
  });
});
