// ABOUTME: Tests the page side of the extension scraps bridge for the collage table.
// ABOUTME: Covers response matching, scrap cleanup, and the no-extension timeout.

import { describe, it, expect, vi, afterEach } from "vitest";
import {
  cleanSessionScraps,
  isSessionScrapsResponse,
  requestSessionScraps,
  SESSION_SCRAPS_REQUEST,
  SESSION_SCRAPS_RESPONSE,
  SESSION_SCRAPS_SOURCE,
} from "../collage/scrapsBridge";
import { newestFirst, toScrapInput } from "../collage/ScrapsPanel";

afterEach(() => {
  vi.useRealTimers();
});

describe("cleanSessionScraps", () => {
  it("drops scraps without a public image URL and sorts newest first", () => {
    const cleaned = cleanSessionScraps([
      { id: "a", src: "https://x.test/a.png", capturedAt: 1 },
      { id: "b", src: "blob:https://x.test/123", capturedAt: 3 },
      { id: "c", src: "chrome-extension://abc/c.png", capturedAt: 4 },
      { id: "d", src: "https://x.test/d.png", pageUrl: "nope", capturedAt: 2 },
      null,
      "junk",
    ]);
    expect(cleaned.map((s) => s.id)).toEqual(["d", "a"]);
    expect(cleaned[0].pageUrl).toBeUndefined();
  });

  it("treats a non-array as no scraps", () => {
    expect(cleanSessionScraps(undefined)).toEqual([]);
  });
});

describe("isSessionScrapsResponse", () => {
  const ok = {
    source: SESSION_SCRAPS_SOURCE,
    type: SESSION_SCRAPS_RESPONSE,
    requestId: "r1",
    scraps: [],
  };
  it("matches only its own request", () => {
    expect(isSessionScrapsResponse(ok, "r1")).toBe(true);
    expect(isSessionScrapsResponse(ok, "r2")).toBe(false);
    expect(isSessionScrapsResponse({ ...ok, source: "other" }, "r1")).toBe(false);
  });
});

describe("requestSessionScraps", () => {
  it("resolves with the scraps an extension sends back", async () => {
    const answer = (event: MessageEvent) => {
      if (event.data?.type !== SESSION_SCRAPS_REQUEST) return;
      window.postMessage(
        {
          source: SESSION_SCRAPS_SOURCE,
          type: SESSION_SCRAPS_RESPONSE,
          requestId: event.data.requestId,
          scraps: [{ id: "s1", src: "https://x.test/s1.png", capturedAt: 5 }],
        },
        "*",
      );
    };
    window.addEventListener("message", answer);
    // jsdom's postMessage leaves event.source null, so stand in for window.
    const realAdd = window.addEventListener.bind(window);
    const spy = vi
      .spyOn(window, "addEventListener")
      .mockImplementation((type: string, listener: any, opts?: any) => {
        if (type !== "message") return realAdd(type, listener, opts);
        realAdd(
          type,
          (e: MessageEvent) =>
            listener(new MessageEvent("message", { data: e.data, source: window })),
          opts,
        );
      });
    const scraps = await requestSessionScraps(window);
    spy.mockRestore();
    window.removeEventListener("message", answer);
    expect(scraps?.map((s) => s.id)).toEqual(["s1"]);
  });

  it("resolves null when no extension answers", async () => {
    vi.useFakeTimers();
    const pending = requestSessionScraps(window);
    vi.advanceTimersByTime(3100);
    await expect(pending).resolves.toBeNull();
  });
});

describe("toScrapInput", () => {
  it("carries the page and the known image size to the table", () => {
    expect(
      toScrapInput({
        id: "s",
        src: "https://x.test/s.png",
        pageUrl: "https://x.test/page",
        width: 400,
        height: 300,
        capturedAt: 0,
      }),
    ).toEqual({
      src: "https://x.test/s.png",
      pageUrl: "https://x.test/page",
      naturalWidth: 400,
      naturalHeight: 300,
    });
  });
});

describe("newestFirst", () => {
  it("puts the latest saved scrap first without touching the original", () => {
    const scraps = [
      { id: "a", src: "https://a.example/a.png", capturedAt: 1 },
      { id: "c", src: "https://a.example/c.png", capturedAt: 3 },
      { id: "b", src: "https://a.example/b.png", capturedAt: 2 },
    ];
    expect(newestFirst(scraps).map((s) => s.id)).toEqual(["c", "b", "a"]);
    expect(scraps[0].id).toBe("a");
  });
});
