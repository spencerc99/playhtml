// ABOUTME: Tests background service worker startup wiring for local data retention.
// ABOUTME: Verifies raw-event pruning stays inactive during service worker startup.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const browserMock = vi.hoisted(() => ({
  storage: {
      local: {
        get: vi.fn().mockResolvedValue({}),
        set: vi.fn().mockResolvedValue(undefined),
        getBytesInUse: vi.fn().mockResolvedValue(1024),
      },
    session: {
      setAccessLevel: vi.fn().mockResolvedValue(undefined),
    },
  },
  runtime: {
    getURL: vi.fn((path: string) => `moz-extension://test/${path}`),
    onInstalled: {
      addListener: vi.fn(),
    },
    onMessage: {
      addListener: vi.fn(),
    },
  },
  tabs: {
    create: vi.fn().mockResolvedValue({}),
  },
  alarms: {
    create: vi.fn(),
    onAlarm: {
      addListener: vi.fn(),
    },
  },
}));

const storeMock = vi.hoisted(() => ({
  getPendingEvents: vi.fn().mockResolvedValue([]),
  markEventsAsUploaded: vi.fn().mockResolvedValue(undefined),
  ensureHistoricalStats: vi.fn().mockResolvedValue(undefined),
  pruneUploadedEventsOlderThan: vi.fn().mockResolvedValue(0),
  getStorageStats: vi.fn().mockResolvedValue({
    totalEvents: 2,
    estimatedSizeBytes: 512,
    oldestEvent: 1_000,
    newestEvent: 2_000,
    countsByType: { cursor: 1, keyboard: 1 },
  }),
}));

vi.mock("webextension-polyfill", () => ({
  default: browserMock,
}));

vi.mock("../storage/LocalEventStore", () => ({
  LocalEventStore: vi.fn(() => storeMock),
}));

vi.mock("../storage/sync", () => ({
  uploadEvents: vi.fn().mockResolvedValue(undefined),
  syncParticipantColor: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../storage/restore", () => ({
  fetchEventsByPid: vi.fn().mockResolvedValue([]),
}));

describe("background local retention", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    Object.defineProperty(globalThis.navigator, "storage", {
      value: {
        estimate: vi.fn().mockResolvedValue({
          usage: 4096,
          quota: 100_000,
        }),
      },
      configurable: true,
    });
    vi.stubGlobal("defineBackground", (setup: () => void) => setup);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("does not schedule uploaded raw-event pruning on startup", async () => {
    const background = await import("../entrypoints/background");

    const startBackground = background.default as unknown as () => void;
    startBackground();

    expect(browserMock.alarms.create).toHaveBeenCalledWith("checkMilestones", {
      periodInMinutes: 5,
    });
    expect(browserMock.alarms.create).not.toHaveBeenCalledWith(
      "pruneLocalEvents",
      expect.anything(),
    );

    const alarmListener =
      browserMock.alarms.onAlarm.addListener.mock.calls[0]?.[0];
    await alarmListener?.({ name: "pruneLocalEvents" });

    expect(storeMock.pruneUploadedEventsOlderThan).not.toHaveBeenCalled();
  });

  it("reports extension local storage usage with collection event stats", async () => {
    const background = await import("../entrypoints/background");

    const startBackground = background.default as unknown as () => void;
    startBackground();

    const messageListener =
      browserMock.runtime.onMessage.addListener.mock.calls[0]?.[0];
    const reply = vi.fn();

    const keepAlive = messageListener?.({ type: "GET_STORAGE_STATS" }, {}, reply);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(keepAlive).toBe(true);
    expect(reply).toHaveBeenCalledWith({
      success: true,
      stats: {
        totalEvents: 2,
        estimatedSizeBytes: 512,
        localUsageBytes: 5120,
        oldestEvent: 1_000,
        newestEvent: 2_000,
        countsByType: { cursor: 1, keyboard: 1 },
      },
    });
  });
});
