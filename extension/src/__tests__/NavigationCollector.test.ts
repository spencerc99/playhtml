// ABOUTME: Tests for NavigationCollector covering page load, tab visibility, and navigation events.
// ABOUTME: Validates event data structure and lifecycle behavior.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  FRAME_FOCUS_IDLE_TIMEOUT_MS,
  IDLE_TIMEOUT_MS,
  NavigationCollector,
} from "../collectors/NavigationCollector";
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
        protocol: "https:",
        hostname: "example.com",
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
      emitCallback.mockClear(); // Ignore synthetic initial focus.

      // Simulate tab switch away
      Object.defineProperty(document, "hidden", { value: true });
      Object.defineProperty(document, "visibilityState", { value: "hidden" });
      
      const visibilityEvent = new Event("visibilitychange", { bubbles: true });
      document.dispatchEvent(visibilityEvent);

      expect(emitCallback).toHaveBeenCalledTimes(1);
      const call = emitCallback.mock.calls[0][0] as NavigationEventData;
      expect(call.event).toBe("blur");
      expect(call.visibility_state).toBe("hidden");
      expect(call.page_ref).toBeTruthy();
      expect(call.title).toBeTruthy();
      // Empty string when the page declares no <link rel="icon">; consumers
      // fall back to Google's S2 favicon service at render time.
      expect(call.favicon_url).toBe("");
    });

    it("emits focus event when tab becomes visible", () => {
      collector.enable();
      emitCallback.mockClear(); // Ignore synthetic initial focus.

      // Simulate tab switch back (hidden -> visible)
      Object.defineProperty(document, "hidden", { value: true });
      Object.defineProperty(document, "visibilityState", { value: "hidden" });
      document.dispatchEvent(new Event("visibilitychange", { bubbles: true }));
      emitCallback.mockClear();

      Object.defineProperty(document, "hidden", { value: false });
      Object.defineProperty(document, "visibilityState", { value: "visible" });
      
      const visibilityEvent = new Event("visibilitychange", { bubbles: true });
      document.dispatchEvent(visibilityEvent);

      expect(emitCallback).toHaveBeenCalledTimes(1);
      const call = emitCallback.mock.calls[0][0] as NavigationEventData;
      expect(call.event).toBe("focus");
      expect(call.visibility_state).toBe("visible");
      expect(call.page_ref).toBeTruthy();
      expect(call.metadata_hash).toBeTruthy();
    });

    it("deduplicates events within 2 second window", () => {
      vi.useFakeTimers();
      collector.enable();
      emitCallback.mockClear(); // Ignore synthetic initial focus.

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
      expect((emitCallback.mock.calls[1][0] as NavigationEventData).quantity).toBe(2);

      vi.useRealTimers();
    });

    it("does not emit when disabled", () => {
      collector.enable();
      emitCallback.mockClear(); // Ignore synthetic initial focus.
      collector.disable();

      const visibilityEvent = new Event("visibilitychange", { bubbles: true });
      document.dispatchEvent(visibilityEvent);

      expect(emitCallback).not.toHaveBeenCalled();
    });
  });

  describe("popstate event", () => {
    it("emits popstate event with URL and state", () => {
      collector.enable();
      emitCallback.mockClear(); // Ignore synthetic initial focus.

      const mockState = { page: 2, filter: "active" };
      const popstateEvent = new PopStateEvent("popstate", {
        state: mockState,
      });

      // Update location before event
      Object.defineProperty(window, "location", {
        value: {
          href: "https://example.com/page?page=2",
          protocol: "https:",
          hostname: "example.com",
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
      expect(call.page_ref).toBeTruthy();
      expect(call.canonical_url).toContain("https://example.com/page?page=2");
    });

    it("handles popstate without state", () => {
      collector.enable();
      emitCallback.mockClear(); // Ignore synthetic initial focus.

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
      emitCallback.mockClear(); // Ignore synthetic initial focus.

      const beforeunloadEvent = new Event("beforeunload", {
        bubbles: false,
        cancelable: true,
      });

      window.dispatchEvent(beforeunloadEvent);

      expect(emitCallback).toHaveBeenCalledTimes(1);
      const call = emitCallback.mock.calls[0][0] as NavigationEventData;
      expect(call.event).toBe("beforeunload");
      expect(call.from_url).toBe("https://example.com/page");
      expect(call.title).toBeTruthy();
    });
  });

  describe("multiple events", () => {
    it("can handle multiple events in sequence", () => {
      collector.enable();
      emitCallback.mockClear(); // Ignore synthetic initial focus.

      Object.defineProperty(document, "hidden", { value: true, configurable: true });
      Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
      document.dispatchEvent(new Event("visibilitychange"));
      Object.defineProperty(document, "hidden", { value: false, configurable: true });
      Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
      document.dispatchEvent(new Event("visibilitychange"));
      Object.defineProperty(document, "hidden", { value: true, configurable: true });
      Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
      document.dispatchEvent(new Event("visibilitychange"));

      expect(emitCallback).toHaveBeenCalledTimes(3);
      expect(emitCallback.mock.calls[0][0].event).toBe("blur");
      expect(emitCallback.mock.calls[1][0].event).toBe("focus");
      expect(emitCallback.mock.calls[2][0].event).toBe("blur");
    });
  });

  describe("idle detection", () => {
    const setVisible = (visible: boolean) => {
      Object.defineProperty(document, "hidden", {
        writable: true,
        configurable: true,
        value: !visible,
      });
      Object.defineProperty(document, "visibilityState", {
        writable: true,
        configurable: true,
        value: visible ? "visible" : "hidden",
      });
    };
    const events = () =>
      emitCallback.mock.calls.map((c) => (c[0] as NavigationEventData).event);

    beforeEach(() => {
      vi.useFakeTimers();
      setVisible(true);
    });

    afterEach(() => {
      document.body.innerHTML = "";
      vi.useRealTimers();
    });

    it("emits an idle blur after no input on a visible tab", () => {
      collector.enable();
      emitCallback.mockClear();

      vi.advanceTimersByTime(IDLE_TIMEOUT_MS - 1);
      expect(emitCallback).not.toHaveBeenCalled();

      vi.advanceTimersByTime(1);
      expect(events()).toEqual(["blur"]);
      const call = emitCallback.mock.calls[0][0] as NavigationEventData;
      expect(call.idle).toBe(true);
      expect(call.visibility_state).toBe("visible");
    });

    it("keeps counting while there is input", () => {
      collector.enable();
      emitCallback.mockClear();

      for (let i = 0; i < 10; i++) {
        vi.advanceTimersByTime(IDLE_TIMEOUT_MS / 2);
        window.dispatchEvent(new Event("pointermove"));
      }
      expect(emitCallback).not.toHaveBeenCalled();
    });

    it("resumes with a focus on the next input after going idle", () => {
      collector.enable();
      vi.advanceTimersByTime(IDLE_TIMEOUT_MS);
      emitCallback.mockClear();

      window.dispatchEvent(new Event("keydown"));
      window.dispatchEvent(new Event("pointermove"));
      expect(events()).toEqual(["focus"]);

      vi.advanceTimersByTime(IDLE_TIMEOUT_MS);
      expect(events()).toEqual(["focus", "blur"]);
    });

    it("does not emit a second blur when an idle tab is hidden", () => {
      collector.enable();
      vi.advanceTimersByTime(IDLE_TIMEOUT_MS);
      emitCallback.mockClear();

      setVisible(false);
      document.dispatchEvent(new Event("visibilitychange"));
      expect(emitCallback).not.toHaveBeenCalled();

      vi.advanceTimersByTime(5_000);
      setVisible(true);
      document.dispatchEvent(new Event("visibilitychange"));
      expect(events()).toEqual(["focus"]);
    });

    it("does not go idle while the tab is hidden", () => {
      collector.enable();
      setVisible(false);
      document.dispatchEvent(new Event("visibilitychange"));
      emitCallback.mockClear();

      vi.advanceTimersByTime(IDLE_TIMEOUT_MS * 3);
      expect(emitCallback).not.toHaveBeenCalled();
    });

    it("treats playing media as active", () => {
      const video = document.createElement("video");
      Object.defineProperty(video, "paused", { value: false, writable: true });
      Object.defineProperty(video, "ended", { value: false });
      Object.defineProperty(video, "readyState", { value: 4 });
      document.body.appendChild(video);

      collector.enable();
      emitCallback.mockClear();
      vi.advanceTimersByTime(IDLE_TIMEOUT_MS * 3);
      expect(emitCallback).not.toHaveBeenCalled();

      (video as { paused: boolean }).paused = true;
      vi.advanceTimersByTime(IDLE_TIMEOUT_MS);
      expect(events()).toEqual(["blur"]);
    });

    it("gives a focused embedded frame the longer timeout", () => {
      const frame = document.createElement("iframe");
      document.body.appendChild(frame);
      frame.focus();
      expect(document.activeElement).toBe(frame);

      collector.enable();
      emitCallback.mockClear();
      vi.advanceTimersByTime(IDLE_TIMEOUT_MS * 2);
      expect(emitCallback).not.toHaveBeenCalled();

      vi.advanceTimersByTime(FRAME_FOCUS_IDLE_TIMEOUT_MS - IDLE_TIMEOUT_MS * 2);
      expect(events()).toEqual(["blur"]);
    });

    it("resumes when focus moves into an embedded frame", () => {
      const frame = document.createElement("iframe");
      document.body.appendChild(frame);

      collector.enable();
      vi.advanceTimersByTime(IDLE_TIMEOUT_MS);
      emitCallback.mockClear();

      frame.focus();
      window.dispatchEvent(new Event("blur"));
      vi.advanceTimersByTime(0);
      expect(events()).toEqual(["focus"]);
    });

    it("stops the idle timer when disabled", () => {
      collector.enable();
      emitCallback.mockClear();
      collector.disable();
      vi.advanceTimersByTime(IDLE_TIMEOUT_MS * 2);
      expect(emitCallback).not.toHaveBeenCalled();
    });
  });

  describe("disabled state", () => {
    it("does not emit events when disabled", () => {
      collector.enable();
      emitCallback.mockClear(); // Ignore synthetic initial focus.
      collector.disable();

      document.dispatchEvent(new Event("visibilitychange"));
      window.dispatchEvent(new PopStateEvent("popstate", { state: null }));

      expect(emitCallback).not.toHaveBeenCalled();
    });
  });
});
