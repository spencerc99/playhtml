// ABOUTME: Tests that shared trails on web pages are read through the background, one type per message,
// ABOUTME: and that a failed Worker read reaches the overlay as an error instead of an empty result.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import browser from "webextension-polyfill";
import { WORKER_URL } from "@movement/config";
import type { CollectionEvent } from "../collectors/types";
import {
  FETCH_SERVER_EVENTS_MESSAGE,
  fetchRecentServerEvents,
  loadHistoricalData,
} from "../storage/historyLoader";

function cursorEvent(id: string, url: string, ts: number): CollectionEvent {
  return {
    id,
    type: "cursor",
    ts,
    data: { x: 0.5, y: 0.5, event: "move" },
    meta: { pid: "pk_a", sid: "sid_a", url, vw: 1000, vh: 800, tz: "UTC" },
  } as CollectionEvent;
}

const sendMessage = browser.runtime.sendMessage as unknown as ReturnType<
  typeof vi.fn
>;

beforeEach(() => {
  sendMessage.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("loadHistoricalData on a web page", () => {
  it("asks the background for each type instead of fetching from the page", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const page = "https://example.com/a";
    sendMessage.mockImplementation(async (message: { eventType: string }) => ({
      ok: true,
      events:
        message.eventType === "cursor"
          ? [cursorEvent("c2", page, 2), cursorEvent("c1", page, 1)]
          : [],
    }));

    const events = await loadHistoricalData(page, "domain", {
      source: "everyone",
      types: ["cursor", "keyboard"],
      limit: 5000,
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(sendMessage.mock.calls.map(([message]) => message)).toEqual([
      {
        type: FETCH_SERVER_EVENTS_MESSAGE,
        domain: "example.com",
        eventType: "cursor",
        limit: 5000,
      },
      {
        type: FETCH_SERVER_EVENTS_MESSAGE,
        domain: "example.com",
        eventType: "keyboard",
        limit: 5000,
      },
    ]);
    expect(events.map((e) => e.id)).toEqual(["c1", "c2"]);
  });

  it("rejects with the background's error so the overlay can show it", async () => {
    sendMessage.mockResolvedValue({
      ok: false,
      error: "Could not load shared trails (server error 403)",
    });

    await expect(
      loadHistoricalData("https://example.com/a", "domain", {
        source: "everyone",
        types: ["cursor"],
      }),
    ).rejects.toThrow("Could not load shared trails (server error 403)");
  });

  it("rejects a forced backfill when the server read fails", async () => {
    sendMessage.mockImplementation(async (message: { type: string }) =>
      message.type === FETCH_SERVER_EVENTS_MESSAGE
        ? { ok: false, error: "Could not reach the server for shared trails" }
        : { events: [] },
    );

    await expect(
      loadHistoricalData("https://example.com/a", "domain", {
        types: ["cursor"],
        forceServerBackfill: true,
      }),
    ).rejects.toThrow("Could not reach the server for shared trails");
  });
});

describe("fetchRecentServerEvents", () => {
  it("reads /events/recent from the configured worker", async () => {
    const event = cursorEvent("c1", "https://example.com/a", 1);
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify([event]), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const events = await fetchRecentServerEvents({
      domain: "example.com",
      type: "cursor",
      limit: 10,
    });

    expect(events).toEqual([event]);
    expect(fetchMock.mock.calls[0][0]).toBe(
      `${WORKER_URL}/events/recent?type=cursor&limit=10&domain=example.com`,
    );
  });

  it("throws with the status when the worker refuses the request", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("Forbidden", { status: 403 })),
    );
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(
      fetchRecentServerEvents({ domain: "example.com", type: "cursor", limit: 10 }),
    ).rejects.toThrow("Could not load shared trails (server error 403)");
    expect(error).toHaveBeenCalledTimes(1);
  });
});
