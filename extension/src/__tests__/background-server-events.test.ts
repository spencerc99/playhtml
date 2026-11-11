// ABOUTME: Verifies the background reads shared events from the Worker for content scripts.
// ABOUTME: Covers the reply shape for success, a refused request, and a malformed message.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WORKER_URL } from "@movement/config";

const originalDefineBackground = (globalThis as any).defineBackground;

async function loadBackgroundListener() {
  const onMessageAddListener = vi.fn();
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
  vi.doMock("../storage/restore", () => ({ restoreEventsFromServer: vi.fn() }));
  vi.doMock("webextension-polyfill", () => ({
    default: {
      storage: {
        local: {
          get: vi.fn().mockResolvedValue({}),
          set: vi.fn().mockResolvedValue(undefined),
          remove: vi.fn().mockResolvedValue(undefined),
        },
      },
      runtime: {
        onInstalled: { addListener: vi.fn() },
        onMessage: { addListener: onMessageAddListener },
        getURL: vi.fn((path: string) => `chrome-extension://test/${path}`),
      },
      tabs: { create: vi.fn().mockResolvedValue(undefined) },
      alarms: {
        get: vi.fn().mockResolvedValue(undefined),
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
  return (message: unknown) =>
    new Promise((resolve) => {
      const async = listener(message, {}, resolve);
      if (async !== true) resolve(undefined);
    });
}

describe("background shared-event reads", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    if (originalDefineBackground === undefined) {
      delete (globalThis as any).defineBackground;
    } else {
      (globalThis as any).defineBackground = originalDefineBackground;
    }
  });

  it("fetches one type of recent events and returns them", async () => {
    const events = [{ id: "e1", type: "cursor", ts: 1, data: {}, meta: {} }];
    const fetchMock = vi.fn(async (input: RequestInfo | URL) =>
      String(input).startsWith(`${WORKER_URL}/events/recent`)
        ? new Response(JSON.stringify(events), { status: 200 })
        : new Response("{}", { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const send = await loadBackgroundListener();

    const reply = await send({
      type: "FETCH_SERVER_EVENTS",
      domain: "example.com",
      eventType: "cursor",
      limit: 5000,
    });

    expect(reply).toEqual({ ok: true, events });
    expect(fetchMock).toHaveBeenCalledWith(
      `${WORKER_URL}/events/recent?type=cursor&limit=5000&domain=example.com`,
    );
  });

  it("replies with an error when the worker refuses the request", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) =>
        String(input).startsWith(`${WORKER_URL}/events/recent`)
          ? new Response("Forbidden", { status: 403 })
          : new Response("{}", { status: 200 }),
      ),
    );
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const send = await loadBackgroundListener();

    const reply = await send({
      type: "FETCH_SERVER_EVENTS",
      domain: "example.com",
      eventType: "cursor",
      limit: 10,
    });

    expect(reply).toEqual({
      ok: false,
      error: "Could not load shared trails (server error 403)",
    });
    expect(
      error.mock.calls.some((call) =>
        String(call[0]).includes("[HistoryLoader] Server fetch failed for cursor: 403"),
      ),
    ).toBe(true);
  });

  it("rejects a message without a valid event type", async () => {
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL) => new Response("{}", { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const send = await loadBackgroundListener();

    const reply = await send({
      type: "FETCH_SERVER_EVENTS",
      domain: "example.com",
      eventType: "not-a-type",
      limit: 10,
    });

    expect(reply).toEqual({
      ok: false,
      error: "Could not load shared trails: bad request",
    });
    expect(
      fetchMock.mock.calls.some(([input]) => String(input).includes("/events/recent")),
    ).toBe(false);
  });
});
