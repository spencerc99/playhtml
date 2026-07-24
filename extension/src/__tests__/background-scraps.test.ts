// ABOUTME: Verifies the background scrap query response used by extension rendering surfaces.
// ABOUTME: Guards union mapping, stable render keys, query limits, ordering, and unknown kinds.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CollectionEvent } from "@playhtml/extension-types";
import { hashScrapString, serializeScrapStyles } from "../collectors/scrapUtils";

const originalDefineBackground = (globalThis as any).defineBackground;

function createEvent(
  id: string,
  ts: number,
  data: Record<string, unknown>,
  domain: string | undefined = "example.com",
): CollectionEvent {
  return {
    id,
    type: "element",
    ts,
    data,
    meta: {
      pid: "pid",
      sid: "sid",
      url: `https://example.com/${id}`,
      vw: 1024,
      vh: 768,
      tz: "America/Los_Angeles",
    },
    domain,
  } as CollectionEvent;
}

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

  it("maps every known scrap kind newest-first and skips unknown kinds", async () => {
    const image = createEvent("image", 100, {
      kind: "image",
      src: "https://cdn.example.com/image.jpg",
      alt: "A found image",
      naturalWidth: 1200,
      naturalHeight: 800,
      displayWidth: 300,
      displayHeight: 200,
      pageTitle: "Image page",
      faviconUrl: "https://example.com/favicon.png",
    });
    const buttonStyles = {
      color: "rgb(1, 2, 3)",
      backgroundColor: "rgb(4, 5, 6)",
    };
    const button = createEvent("button", 200, {
      kind: "button",
      text: "Keep this",
      styles: buttonStyles,
      innerSvg: "<svg/>",
      pageTitle: "Button page",
    });
    const svg = createEvent("svg", 300, {
      kind: "svg-icon",
      markup: '<svg viewBox="0 0 24 24"/>',
      width: 24,
      height: 24,
      pageTitle: "SVG page",
    });
    const cursor = createEvent("cursor", 400, {
      kind: "cursor",
      url: "data:image/png;base64,AAAA",
      hotspotX: 2,
      hotspotY: 3,
      pageTitle: "Cursor page",
    });
    const unknown = createEvent("future", 500, {
      kind: "future-kind",
      pageTitle: "Future page",
    }, undefined);
    const queryByType = vi.fn().mockResolvedValue([
      button,
      unknown,
      image,
      cursor,
      svg,
    ]);
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

    expect(queryByType).toHaveBeenCalledWith("element", { limit: 5000 });
    expect(response).toEqual({
      scraps: [
        {
          id: "cursor",
          key: "data:image/png;base64,AAAA",
          kind: "cursor",
          domain: "example.com",
          pageUrl: "https://example.com/cursor",
          ts: 400,
          pageTitle: "Cursor page",
          url: "data:image/png;base64,AAAA",
          hotspotX: 2,
          hotspotY: 3,
        },
        {
          id: "svg",
          key: hashScrapString('<svg viewBox="0 0 24 24"/>'),
          kind: "svg-icon",
          domain: "example.com",
          pageUrl: "https://example.com/svg",
          ts: 300,
          pageTitle: "SVG page",
          markup: '<svg viewBox="0 0 24 24"/>',
          width: 24,
          height: 24,
        },
        {
          id: "button",
          key: hashScrapString(
            `Keep this\n${serializeScrapStyles(buttonStyles)}`,
          ),
          kind: "button",
          domain: "example.com",
          pageUrl: "https://example.com/button",
          ts: 200,
          pageTitle: "Button page",
          text: "Keep this",
          styles: buttonStyles,
          innerSvg: "<svg/>",
        },
        {
          id: "image",
          key: "https://cdn.example.com/image.jpg",
          kind: "image",
          domain: "example.com",
          pageUrl: "https://example.com/image",
          ts: 100,
          pageTitle: "Image page",
          faviconUrl: "https://example.com/favicon.png",
          src: "https://cdn.example.com/image.jpg",
          alt: "A found image",
          naturalWidth: 1200,
          naturalHeight: 800,
        },
      ],
    });
  });

  it("passes an explicit query limit through unchanged", async () => {
    const queryByType = vi.fn().mockResolvedValue([]);
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
    await new Promise((resolve) => {
      listener({ type: "GET_SCRAPS", options: { limit: 25 } }, {}, resolve);
    });

    expect(queryByType).toHaveBeenCalledWith("element", { limit: 25 });
  });
});
