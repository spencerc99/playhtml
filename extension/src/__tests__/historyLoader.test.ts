// ABOUTME: Tests that shared trails on web pages are read through the background, one type per message,
// ABOUTME: page mode sends only hashes of the page URL, and a failed Worker read reaches the overlay as an error.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import browser from "webextension-polyfill";
import { createHash } from "node:crypto";
import { WORKER_URL } from "@movement/config";
import type { CollectionEvent } from "../collectors/types";
import {
  FETCH_SERVER_EVENTS_MESSAGE,
  fetchRecentServerEvents,
  loadHistoricalData,
  pageUrlHashes,
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

  it("asks for this page only in page mode and keeps the normalized filter", async () => {
    const page = "https://en.wikipedia.org/wiki/Cat?useskin=vector#History";
    sendMessage.mockImplementation(async () => ({
      ok: true,
      events: [
        cursorEvent("c1", "https://en.wikipedia.org/wiki/Cat?useskin=vector", 1),
        cursorEvent("c2", "https://en.wikipedia.org/wiki/Cat/", 2),
        cursorEvent("d1", "https://en.wikipedia.org/wiki/Dog", 3),
      ],
    }));

    const events = await loadHistoricalData(page, "url", {
      source: "everyone",
      types: ["cursor"],
      limit: 5000,
    });

    const md5 = (text: string) => createHash("md5").update(text, "utf8").digest("hex");
    expect(sendMessage.mock.calls.map(([message]) => message)).toEqual([
      {
        type: FETCH_SERVER_EVENTS_MESSAGE,
        urlHashes: [
          md5("https://en.wikipedia.org/wiki/Cat?useskin=vector"),
          md5("https://en.wikipedia.org/wiki/Cat/?useskin=vector"),
          md5("https://en.wikipedia.org/wiki/Cat"),
          md5("https://en.wikipedia.org/wiki/Cat/"),
        ],
        eventType: "cursor",
        limit: 5000,
      },
    ]);
    expect(JSON.stringify(sendMessage.mock.calls)).not.toContain("wikipedia");
    expect(events.map((e) => e.id)).toEqual(["c1", "c2"]);
  });

  it("refuses page mode on a page that is not http(s) without asking the Worker", async () => {
    await expect(
      loadHistoricalData("file:///Users/me/notes.html", "url", {
        source: "everyone",
        types: ["cursor"],
      }),
    ).rejects.toThrow("Could not load shared trails for this page");
    expect(sendMessage).not.toHaveBeenCalled();
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
  beforeEach(async () => {
    const pair = (await crypto.subtle.generateKey(
      { name: "ECDSA", namedCurve: "P-256" },
      true,
      ["sign", "verify"],
    )) as CryptoKeyPair;
    const raw = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
    const publicKey = `pk_${[...raw].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
    vi.mocked(browser.storage.local.get).mockResolvedValue({
      playerIdentity: {
        public: { publicKey, playerStyle: { colorPalette: ["#e04488"] } },
        privateKey: await crypto.subtle.exportKey("jwk", pair.privateKey),
      },
    });
  });

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
    const headers = new Headers(fetchMock.mock.calls[0][1]?.headers);
    expect(headers.get("X-WWO-Public-Id")).toMatch(/^pk_04[0-9a-f]{128}$/);
    expect(headers.get("X-WWO-Signature")).toMatch(/^[0-9a-f]{128}$/);
  });

  it("asks for one page by its url hashes instead of its domain", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify([]), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const hashes = ["0cc175b9c0f1b6a831c399e269772661", "900150983cd24fb0d6963f7d28e17f72"];

    await fetchRecentServerEvents({ urlHashes: hashes, type: "keyboard", limit: 10 });

    expect(fetchMock.mock.calls[0][0]).toBe(
      `${WORKER_URL}/events/recent?type=keyboard&limit=10&urlHash=${hashes.join("%2C")}`,
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

describe("pageUrlHashes for a very long page URL", () => {
  const md5 = (value: string) => createHash("md5").update(value).digest("hex");

  it("looks the page up by its address without the query string", () => {
    const long = `https://example.com/search?q=${"a".repeat(3000)}#top`;

    expect(pageUrlHashes(long)).toEqual([
      md5("https://example.com/search"),
      md5("https://example.com/search/"),
    ]);
  });

  it("still refuses a page whose path alone is too long", () => {
    expect(() =>
      pageUrlHashes(`https://example.com/${"a".repeat(3000)}`),
    ).toThrow("Could not load shared trails for this page");
  });
});
