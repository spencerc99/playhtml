// ABOUTME: Covers background upload flushing through the extension message handler.
// ABOUTME: Verifies pending event drain size and upload marking behavior.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CollectionEvent } from "@playhtml/extension-types";

const originalDefineBackground = (globalThis as any).defineBackground;

function makeEvent(id: string): CollectionEvent {
  return {
    id,
    type: "navigation",
    ts: 1,
    data: { event: "focus" },
    meta: {
      pid: "pid",
      sid: "sid",
      url: "https://example.com/",
      vw: 1024,
      vh: 768,
      tz: "America/New_York",
    },
  };
}

describe("background upload flushing", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    if (originalDefineBackground === undefined) {
      delete (globalThis as any).defineBackground;
    } else {
      (globalThis as any).defineBackground = originalDefineBackground;
    }
  });

  it("drains up to the worker request limit per flush", async () => {
    const pendingEvents = [makeEvent("event-1")];
    const store = {
      getPendingEvents: vi.fn().mockResolvedValue(pendingEvents),
      markEventsAsUploaded: vi.fn().mockResolvedValue(undefined),
      addEvents: vi.fn(),
      getGlobalStats: vi.fn(),
      getAllDomains: vi.fn(),
      getAllEvents: vi.fn(),
    };
    const uploadEvents = vi.fn().mockResolvedValue(undefined);
    const onMessageAddListener = vi.fn();

    vi.doMock("../storage/LocalEventStore", () => ({
      LocalEventStore: vi.fn(() => store),
    }));
    vi.doMock("../storage/sync", () => ({
      uploadEvents,
      syncParticipantColor: vi.fn(),
    }));
    vi.doMock("../storage/restore", () => ({
      fetchEventsByPid: vi.fn(),
    }));
    vi.doMock("webextension-polyfill", () => ({
      default: {
        storage: {
          local: {
            get: vi.fn().mockResolvedValue({ collection_mode_navigation: "shared" }),
            set: vi.fn().mockResolvedValue(undefined),
            remove: vi.fn().mockResolvedValue(undefined),
          },
        },
        runtime: {
          onInstalled: { addListener: vi.fn() },
          onMessage: { addListener: onMessageAddListener },
          getURL: vi.fn((path: string) => `chrome-extension://test/${path}`),
        },
        tabs: {
          create: vi.fn().mockResolvedValue(undefined),
          captureVisibleTab: vi.fn().mockResolvedValue("data:image/png;base64,test"),
        },
        alarms: {
          create: vi.fn(),
          onAlarm: { addListener: vi.fn() },
        },
      },
    }));

    (globalThis as any).defineBackground = (setup: () => void) => {
      setup();
      return setup;
    };

    await import("../entrypoints/background");

    const listener = onMessageAddListener.mock.calls[0][0];
    const response = await new Promise((resolve) => {
      const handled = listener({ type: "FLUSH_PENDING_UPLOADS" }, {}, resolve);
      expect(handled).toBe(true);
    });

    expect(response).toEqual({ success: true });
    expect(store.getPendingEvents).toHaveBeenCalledWith(500);
    expect(uploadEvents).toHaveBeenCalledWith(pendingEvents);
    expect(store.markEventsAsUploaded).toHaveBeenCalledWith(["event-1"]);
  });
});
