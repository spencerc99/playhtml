// ABOUTME: Verifies the background scrap query response used by extension rendering surfaces.
// ABOUTME: Guards newest-first query limits and stored-event metadata mapping.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CollectionEvent } from "@playhtml/extension-types";

const originalDefineBackground = (globalThis as any).defineBackground;

describe("background scrap queries", () => {
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

  it("returns stored scraps with the default limit and rendering shape", async () => {
    const event: CollectionEvent = {
      id: "scrap-1",
      type: "image",
      ts: 1234,
      data: {
        src: "https://cdn.example.com/image.jpg",
        alt: "A found image",
        naturalWidth: 1200,
        naturalHeight: 800,
        displayWidth: 300,
        displayHeight: 200,
        pageTitle: "Example page",
        faviconUrl: "https://example.com/favicon.png",
      },
      meta: {
        pid: "pid",
        sid: "sid",
        url: "https://example.com/page",
        vw: 1024,
        vh: 768,
        tz: "America/Los_Angeles",
      },
      domain: "example.com",
    };
    const queryByType = vi.fn().mockResolvedValue([event]);
    const onMessageAddListener = vi.fn();

    vi.doMock("../storage/LocalEventStore", () => ({
      LocalEventStore: vi.fn(() => ({ queryByType })),
    }));
    vi.doMock("../storage/sync", () => ({ uploadEvents: vi.fn() }));
    vi.doMock("../storage/restore", () => ({ fetchEventsByPid: vi.fn() }));
    vi.doMock("webextension-polyfill", () => ({
      default: {
        storage: {
          local: {
            get: vi.fn().mockResolvedValue({}),
            set: vi.fn().mockResolvedValue(undefined),
          },
        },
        runtime: {
          onInstalled: { addListener: vi.fn() },
          onMessage: { addListener: onMessageAddListener },
          getURL: vi.fn((path: string) => `chrome-extension://test/${path}`),
        },
        tabs: {
          create: vi.fn().mockResolvedValue(undefined),
          query: vi.fn().mockResolvedValue([]),
          sendMessage: vi.fn().mockResolvedValue(undefined),
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
      const handled = listener({ type: "GET_SCRAPS" }, {}, resolve);
      expect(handled).toBe(true);
    });

    expect(queryByType).toHaveBeenCalledWith("image", { limit: 5000 });
    expect(response).toEqual({
      scraps: [{
        id: "scrap-1",
        src: "https://cdn.example.com/image.jpg",
        alt: "A found image",
        pageTitle: "Example page",
        faviconUrl: "https://example.com/favicon.png",
        domain: "example.com",
        pageUrl: "https://example.com/page",
        ts: 1234,
        naturalWidth: 1200,
        naturalHeight: 800,
      }],
    });
  });
});
