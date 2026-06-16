// ABOUTME: Tests background service worker startup wiring for local data retention.
// ABOUTME: Verifies raw-event pruning stays inactive during service worker startup.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const browserMock = vi.hoisted(() => ({
  storage: {
    local: {
      get: vi.fn().mockResolvedValue({}),
      set: vi.fn().mockResolvedValue(undefined),
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
});
