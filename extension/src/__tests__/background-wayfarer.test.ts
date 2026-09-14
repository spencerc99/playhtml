// ABOUTME: Verifies the background handlers that record and serve the wayfarer journey.
// ABOUTME: Only a content script may add a stop; any extension surface may read the journey back.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  WAYFARER_JOURNEY_KEY,
  type Journey,
} from "../features/wayfarer/journey";

const originalDefineBackground = (globalThis as any).defineBackground;

async function loadBackground(storageData: Record<string, unknown>) {
  const listeners: Array<
    (message: any, sender: any, reply: (response?: unknown) => void) => unknown
  > = [];

  vi.doMock("../storage/LocalEventStore", () => ({
    LocalEventStore: vi.fn(() => ({
      getPendingEvents: vi.fn(),
      markEventsAsUploaded: vi.fn(),
      addEvents: vi.fn(),
      getGlobalStats: vi.fn(),
      getAllDomains: vi.fn(),
      getAllEvents: vi.fn(),
    })),
  }));
  vi.doMock("../storage/sync", () => ({ uploadEvents: vi.fn() }));
  vi.doMock("../storage/restore", () => ({ fetchEventsByPid: vi.fn() }));
  vi.doMock("webextension-polyfill", () => ({
    default: {
      storage: {
        local: {
          get: vi.fn((keys?: any) => {
            if (Array.isArray(keys)) {
              return Promise.resolve(
                Object.fromEntries(keys.map((key) => [key, storageData[key]])),
              );
            }
            if (typeof keys === "string") {
              return Promise.resolve({ [keys]: storageData[keys] });
            }
            return Promise.resolve({ ...storageData });
          }),
          set: vi.fn((items: Record<string, unknown>) => {
            Object.assign(storageData, items);
            return Promise.resolve();
          }),
          remove: vi.fn(),
        },
        session: { setAccessLevel: vi.fn().mockResolvedValue(undefined) },
      },
      runtime: {
        onInstalled: { addListener: vi.fn() },
        onMessage: {
          addListener: vi.fn((listener: (typeof listeners)[number]) => {
            listeners.push(listener);
          }),
        },
        getURL: vi.fn((path: string) => `chrome-extension://test/${path}`),
      },
      tabs: {
        create: vi.fn().mockResolvedValue(undefined),
        captureVisibleTab: vi.fn().mockResolvedValue("data:image/png;base64,test"),
      },
      alarms: { create: vi.fn(), onAlarm: { addListener: vi.fn() } },
    },
  }));

  (globalThis as any).defineBackground = (setup: () => void) => {
    setup();
    return setup;
  };

  await import("../entrypoints/background");

  return function send(message: unknown, sender: unknown): Promise<unknown> {
    return new Promise((resolve) => {
      let settled = false;
      const reply = (response?: unknown) => {
        if (settled) return;
        settled = true;
        resolve(response);
      };
      for (const listener of listeners) {
        listener(message, sender, reply);
        if (settled) return;
      }
    });
  };
}

describe("background wayfarer messages", () => {
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

  it("records a stop sent by a content script and serves it back", async () => {
    const storageData: Record<string, unknown> = {};
    const send = await loadBackground(storageData);

    const visit = (await send(
      {
        type: "WAYFARER_VISIT",
        url: "https://example.com/a?utm=1#top",
        title: "A page",
      },
      { tab: { id: 7, url: "https://example.com/a" } },
    )) as { journey: Journey | null };

    expect(visit.journey?.stops).toHaveLength(1);
    expect(visit.journey?.stops[0].url).toBe("https://example.com/a");
    expect(visit.journey?.stops[0].title).toBe("A page");
    expect(
      (storageData[WAYFARER_JOURNEY_KEY] as Journey).stops[0].url,
    ).toBe("https://example.com/a");

    const read = (await send({ type: "WAYFARER_GET_JOURNEY" }, {})) as {
      journey: Journey | null;
    };
    expect(read.journey?.stops.map((stop) => stop.url)).toEqual([
      "https://example.com/a",
    ]);
  });

  it("ignores a visit that did not come from a page", async () => {
    const storageData: Record<string, unknown> = {};
    const send = await loadBackground(storageData);

    const response = await send(
      { type: "WAYFARER_VISIT", url: "https://example.com/a" },
      {},
    );

    expect(response).toEqual({ journey: null });
    expect(storageData[WAYFARER_JOURNEY_KEY]).toBeUndefined();
  });

  it("ignores a visit without a url", async () => {
    const storageData: Record<string, unknown> = {};
    const send = await loadBackground(storageData);

    const response = await send(
      { type: "WAYFARER_VISIT", title: "no url" },
      { tab: { id: 7 } },
    );

    expect(response).toEqual({ journey: null });
    expect(storageData[WAYFARER_JOURNEY_KEY]).toBeUndefined();
  });

  it("returns an empty journey when nothing has been recorded", async () => {
    const send = await loadBackground({});

    expect(await send({ type: "WAYFARER_GET_JOURNEY" }, {})).toEqual({
      journey: { stops: [], updatedAt: 0 },
    });
  });
});
