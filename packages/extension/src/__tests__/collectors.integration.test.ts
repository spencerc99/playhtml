import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { CollectorManager } from "../collectors/CollectorManager";
import { CursorCollector } from "../collectors/CursorCollector";
import { NavigationCollector } from "../collectors/NavigationCollector";
import { ViewportCollector } from "../collectors/ViewportCollector";
import { EventBuffer } from "../storage/EventBuffer";
import { simulateMouseMove, simulateScroll, advanceTime } from "./test-utils";
import browser from "webextension-polyfill";

// Mock the storage module
vi.mock("../storage/sync", () => ({
  uploadEvents: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../storage/participant", () => ({
  getParticipantId: vi.fn().mockResolvedValue("test-pid"),
  getSessionId: vi.fn().mockResolvedValue("test-sid"),
  getTimezone: vi.fn().mockReturnValue("America/New_York"),
}));

describe("Collector Integration", () => {
  let manager: CollectorManager;
  let storageData: Record<string, any>;

  beforeEach(() => {
    vi.useFakeTimers();
    storageData = {};

    // Mock browser.storage.local
    vi.mocked(browser.storage.local.get).mockImplementation((keys) => {
      let result: Record<string, any> = {};
      if (Array.isArray(keys)) {
        keys.forEach((key) => {
          result[key] = storageData[key];
        });
      } else if (typeof keys === "string") {
        result[keys] = storageData[keys];
      } else {
        result = { ...storageData };
      }
      return Promise.resolve(result);
    });

    vi.mocked(browser.storage.local.set).mockImplementation((items) => {
      Object.assign(storageData, items);
      return Promise.resolve();
    });

    manager = new CollectorManager();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  describe("collector registration", () => {
    it("registers multiple collectors", () => {
      const cursorCollector = new CursorCollector();
      const navigationCollector = new NavigationCollector();
      const viewportCollector = new ViewportCollector();

      manager.registerCollector(cursorCollector);
      manager.registerCollector(navigationCollector);
      manager.registerCollector(viewportCollector);

      const statuses = manager.getCollectorStatuses();
      expect(statuses).toHaveLength(3);
      expect(statuses.map((s) => s.type)).toContain("cursor");
      expect(statuses.map((s) => s.type)).toContain("navigation");
      expect(statuses.map((s) => s.type)).toContain("viewport");
    });

    it("retrieves registered collector by type", () => {
      const cursorCollector = new CursorCollector();
      manager.registerCollector(cursorCollector);

      const retrieved = manager.getCollector("cursor");
      expect(retrieved).toBe(cursorCollector);
    });

    it("returns undefined for unregistered collector", () => {
      const retrieved = manager.getCollector("cursor");
      expect(retrieved).toBeUndefined();
    });
  });

  describe("enable/disable collectors", () => {
    it("enables a collector independently", async () => {
      const cursorCollector = new CursorCollector();
      const navigationCollector = new NavigationCollector();

      manager.registerCollector(cursorCollector);
      manager.registerCollector(navigationCollector);

      await manager.enableCollector("cursor");

      expect(cursorCollector.isEnabled()).toBe(true);
      expect(navigationCollector.isEnabled()).toBe(false);
    });

    it("disables a collector independently", async () => {
      const cursorCollector = new CursorCollector();
      manager.registerCollector(cursorCollector);

      await manager.enableCollector("cursor");
      expect(cursorCollector.isEnabled()).toBe(true);

      await manager.disableCollector("cursor");
      expect(cursorCollector.isEnabled()).toBe(false);
    });

    it("saves enabled state to storage", async () => {
      const cursorCollector = new CursorCollector();
      manager.registerCollector(cursorCollector);

      await manager.enableCollector("cursor");

      expect(browser.storage.local.set).toHaveBeenCalled();
      const call = vi.mocked(browser.storage.local.set).mock.calls[0][0];
      expect(call["collection_enabled_collectors"]?.cursor).toBe(true);
    });

    it("loads enabled state from storage on init", async () => {
      // Pre-populate storage
      storageData["collection_enabled_collectors"] = {
        cursor: true,
        navigation: false,
      };

      const cursorCollector = new CursorCollector();
      const navigationCollector = new NavigationCollector();

      manager.registerCollector(cursorCollector);
      manager.registerCollector(navigationCollector);

      await manager.init();

      expect(cursorCollector.isEnabled()).toBe(true);
      expect(navigationCollector.isEnabled()).toBe(false);
    });
  });

  describe("event emission to buffer", () => {
    it("routes events from collectors to EventBuffer", async () => {
      const cursorCollector = new CursorCollector();
      manager.registerCollector(cursorCollector);

      await manager.enableCollector("cursor");

      // Mock EventBuffer methods
      const eventBuffer = manager.getEventBuffer();
      const createEventSpy = vi.spyOn(eventBuffer, "createEvent");
      const addEventSpy = vi.spyOn(eventBuffer, "addEvent");

      // Trigger event
      simulateMouseMove(100, 100);
      await advanceTime(250);

      // Event should be created and added to buffer
      expect(createEventSpy).toHaveBeenCalled();
      expect(addEventSpy).toHaveBeenCalled();

      createEventSpy.mockRestore();
      addEventSpy.mockRestore();
    });

    it("creates events with correct type and data", async () => {
      const cursorCollector = new CursorCollector();
      manager.registerCollector(cursorCollector);

      await manager.enableCollector("cursor");

      const eventBuffer = manager.getEventBuffer();
      const createEventSpy = vi.spyOn(eventBuffer, "createEvent");

      simulateMouseMove(100, 100);
      await advanceTime(250);

      expect(createEventSpy).toHaveBeenCalledWith(
        "cursor",
        expect.objectContaining({
          x: expect.any(Number),
          y: expect.any(Number),
        })
      );

      createEventSpy.mockRestore();
    });

    it("handles events from multiple collectors", async () => {
      const cursorCollector = new CursorCollector();
      const navigationCollector = new NavigationCollector();
      const viewportCollector = new ViewportCollector();

      manager.registerCollector(cursorCollector);
      manager.registerCollector(navigationCollector);
      manager.registerCollector(viewportCollector);

      await manager.enableCollector("cursor");
      await manager.enableCollector("navigation");
      await manager.enableCollector("viewport");

      const eventBuffer = manager.getEventBuffer();
      const addEventSpy = vi.spyOn(eventBuffer, "addEvent");

      // Trigger events from different collectors
      simulateMouseMove(100, 100);
      window.dispatchEvent(new Event("focus"));
      simulateScroll(0, 100);

      await advanceTime(250);

      // Should have events from multiple collectors
      expect(addEventSpy).toHaveBeenCalled();
      const calls = addEventSpy.mock.calls;
      expect(calls.length).toBeGreaterThan(0);

      addEventSpy.mockRestore();
    });
  });

  describe("collector statuses", () => {
    it("returns status for all registered collectors", () => {
      const cursorCollector = new CursorCollector();
      const navigationCollector = new NavigationCollector();

      manager.registerCollector(cursorCollector);
      manager.registerCollector(navigationCollector);

      const statuses = manager.getCollectorStatuses();
      expect(statuses).toHaveLength(2);

      const cursorStatus = statuses.find((s) => s.type === "cursor");
      expect(cursorStatus).toBeDefined();
      expect(cursorStatus?.description).toBe(cursorCollector.description);
      expect(cursorStatus?.enabled).toBe(false);
    });

    it("reflects enabled state in statuses", async () => {
      const cursorCollector = new CursorCollector();
      manager.registerCollector(cursorCollector);

      let statuses = manager.getCollectorStatuses();
      expect(statuses[0].enabled).toBe(false);

      await manager.enableCollector("cursor");

      statuses = manager.getCollectorStatuses();
      expect(statuses[0].enabled).toBe(true);
    });
  });

  describe("event buffer integration", () => {
    it("provides access to EventBuffer", () => {
      const eventBuffer = manager.getEventBuffer();
      expect(eventBuffer).toBeInstanceOf(EventBuffer);
    });

    it("can flush events manually", async () => {
      const eventBuffer = manager.getEventBuffer();
      const flushSpy = vi.spyOn(eventBuffer, "flushBatch");

      await manager.flushEvents();

      expect(flushSpy).toHaveBeenCalled();
      flushSpy.mockRestore();
    });
  });

  describe("error handling", () => {
    it("handles errors when adding events gracefully", async () => {
      const cursorCollector = new CursorCollector();
      manager.registerCollector(cursorCollector);

      await manager.enableCollector("cursor");

      const eventBuffer = manager.getEventBuffer();
      vi.spyOn(eventBuffer, "addEvent").mockRejectedValue(
        new Error("Buffer error")
      );

      const consoleErrorSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});

      // Should not throw
      simulateMouseMove(100, 100);
      await advanceTime(250);

      expect(consoleErrorSpy).toHaveBeenCalled();
      consoleErrorSpy.mockRestore();
    });
  });
});
