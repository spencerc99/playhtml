// ABOUTME: Verifies the background scrap query response used by extension rendering surfaces.
// ABOUTME: Guards union mapping, stable render keys, query limits, ordering, and unknown kinds.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CollectionEvent } from "@playhtml/extension-types";
import type { ScrapRecord } from "../entrypoints/background";
import { groupPhotoEncounters } from "@movement/utils/scrapPhotoGroups";
import {
  hashScrapString,
  serializeScrapStyles,
} from "../collectors/scrapUtils";

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
      backdropColor: "rgb(28, 32, 38)",
      pageTitle: "Button page",
    });
    const svg = createEvent("svg", 300, {
      kind: "svg-icon",
      markup: '<svg viewBox="0 0 24 24"/>',
      width: 24,
      height: 24,
      pageTitle: "SVG page",
    });
    const headingStyles = {
      fontFamily: "Georgia, serif",
      fontSize: "32px",
    };
    const headingPosition = {
      pageX: 480,
      pageY: 220,
      pageWidth: 1024,
      pageHeight: 4200,
    };
    const heading = createEvent("heading", 350, {
      kind: "heading",
      text: "What the tide left behind",
      level: 2,
      styles: headingStyles,
      pageTitle: "Heading page",
      position: headingPosition,
    });
    const cursor = createEvent("cursor", 400, {
      kind: "cursor",
      url: "data:image/png;base64,AAAA",
      hotspotX: 2,
      hotspotY: 3,
      pageTitle: "Cursor page",
    });
    const unknown = createEvent(
      "future",
      500,
      {
        kind: "future-kind",
        pageTitle: "Future page",
      },
      undefined,
    );
    const queryEventPage = vi.fn().mockResolvedValue({
      events: [unknown, cursor, heading, svg, button, image],
      nextCursor: null,
    });
    const onMessageAddListener = vi.fn();

    vi.doMock("../storage/LocalEventStore", () => ({
      LocalEventStore: vi.fn(() => ({ queryEventPage })),
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

    expect(queryEventPage).toHaveBeenCalledWith("element", 200, undefined);
    expect(response).toEqual({
      nextCursor: null,
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
          id: "heading",
          key: hashScrapString(
            `2\nWhat the tide left behind\n${serializeScrapStyles(headingStyles)}`,
          ),
          kind: "heading",
          domain: "example.com",
          pageUrl: "https://example.com/heading",
          ts: 350,
          pageTitle: "Heading page",
          position: headingPosition,
          text: "What the tide left behind",
          level: 2,
          styles: headingStyles,
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
          backdropColor: "rgb(28, 32, 38)",
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
          encounterDay: "1969-12-31",
          alt: "A found image",
          naturalWidth: 1200,
          naturalHeight: 800,
        },
      ],
    });
  });

  it("groups photo sources after loading across page boundaries", async () => {
    const photo = {
      kind: "image",
      src: "https://cdn.example.com/first.jpg",
      contentHash: "a".repeat(64),
      naturalWidth: 600,
      naturalHeight: 400,
      pageTitle: "Photo",
    };
    const pageCursor = { ts: 100, id: "first-place" };
    const queryEventPage = vi
      .fn()
      .mockResolvedValueOnce({
        events: [createEvent("first-place", 100, photo)],
        nextCursor: pageCursor,
      })
      .mockResolvedValueOnce({
        events: [
          createEvent("other-photo", 50, {
            ...photo,
            src: "https://cdn.example.com/other.jpg",
            contentHash: "b".repeat(64),
          }),
          createEvent("second-place", 1, {
            ...photo,
            src: "https://cdn.example.com/copy.jpg",
          }),
        ],
        nextCursor: null,
      });
    const onMessageAddListener = vi.fn();

    vi.doMock("../storage/LocalEventStore", () => ({
      LocalEventStore: vi.fn(() => ({ queryEventPage })),
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
    const first = await new Promise<{
      scraps: ScrapRecord[];
      nextCursor: { ts: number; id: string };
    }>((resolve) => {
      listener({ type: "GET_SCRAPS", options: { limit: 1 } }, {}, resolve);
    });
    const second = await new Promise<typeof first>((resolve) => {
      listener(
        { type: "GET_SCRAPS", options: { limit: 1, cursor: first.nextCursor } },
        {},
        resolve,
      );
    });
    const grouped = groupPhotoEncounters([...first.scraps, ...second.scraps]);

    expect(first.scraps).toHaveLength(1);
    expect(grouped).toHaveLength(2);
    expect(grouped[0].sources?.map((source) => source.pageUrl)).toEqual([
      "https://example.com/first-place",
      "https://example.com/second-place",
    ]);
    expect(queryEventPage).toHaveBeenNthCalledWith(2, "element", 1, pageCursor);
  });
  it("requests a bounded first page when no limit is requested", async () => {
    const allEvents = Array.from({ length: 6000 }, (_, index) =>
      createEvent(`cursor-${index}`, index, {
        kind: "cursor",
        url: `https://example.com/cursor-${index}.png`,
        pageTitle: "Cursor page",
      }),
    );
    const queryEventPage = vi.fn().mockImplementation(async (_type, limit) => ({
      events: allEvents.slice(0, limit),
      nextCursor: { ts: 199, id: "cursor-199" },
    }));
    const onMessageAddListener = vi.fn();

    vi.doMock("../storage/LocalEventStore", () => ({
      LocalEventStore: vi.fn(() => ({ queryEventPage })),
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
    const response = await new Promise<{ scraps: unknown[] }>((resolve) => {
      listener({ type: "GET_SCRAPS" }, {}, resolve);
    });

    expect(queryEventPage).toHaveBeenCalledWith("element", 200, undefined);
    expect(response.scraps).toHaveLength(200);
  });

});
