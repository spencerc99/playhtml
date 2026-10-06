import { describe, expect, it } from "vitest";
import {
  SESSION_GAP_MS,
  SESSION_LOOKBACK_MS,
  SESSION_SCRAP_LIMIT,
  clampWindow,
  selectSessionScraps,
  type SessionScrapCandidate,
} from "../features/sessionScraps/sessionScraps";
import {
  SESSION_SCRAPS_BRIDGE_SOURCE,
  SESSION_SCRAPS_REQUEST,
  isSessionScrapsPageUrl,
  isSessionScrapsRequest,
} from "../features/sessionScraps/sessionScrapsBridge";

const NOW = 1_800_000_000_000;
const MIN = 60_000;

function scrap(minutesAgo: number, overrides: Partial<SessionScrapCandidate> = {}): SessionScrapCandidate {
  return {
    id: `scrap-${minutesAgo}`,
    src: `https://example.com/${minutesAgo}.jpg`,
    pageUrl: "https://example.com/page",
    ts: NOW - minutesAgo * MIN,
    naturalWidth: 400,
    naturalHeight: 300,
    ...overrides,
  };
}

describe("selectSessionScraps", () => {
  it("takes the latest burst and stops at the first long break", () => {
    const answer = selectSessionScraps([scrap(1), scrap(20), scrap(50), scrap(50 + 46), scrap(120)], {
      now: NOW,
    });
    expect(answer.scraps.map((s) => s.capturedAt)).toEqual([NOW - MIN, NOW - 20 * MIN, NOW - 50 * MIN]);
    expect(answer.window).toEqual({ start: NOW - 50 * MIN, end: NOW - MIN });
  });

  it("keeps everything inside an explicit window, breaks and all", () => {
    const since = NOW - 3 * 60 * MIN;
    const answer = selectSessionScraps([scrap(1), scrap(100), scrap(170), scrap(200)], { now: NOW, since });
    expect(answer.scraps).toHaveLength(3);
    expect(answer.window).toEqual({ start: since, end: NOW });
  });

  it("never reaches past the lookback, whatever the page asks", () => {
    expect(clampWindow(NOW, 0).start).toBe(NOW - SESSION_LOOKBACK_MS);
    expect(clampWindow(NOW, undefined, NOW + 1e9).end).toBe(NOW);
  });

  it("drops repeats and images that only resolve on this machine", () => {
    const answer = selectSessionScraps(
      [
        scrap(1, { contentHash: "same" }),
        scrap(2, { contentHash: "same", src: "https://other.com/a.jpg" }),
        scrap(3, { src: "data:image/png;base64,AAAA" }),
        scrap(4, { src: "blob:https://example.com/123" }),
      ],
      { now: NOW },
    );
    expect(answer.scraps.map((s) => s.src)).toEqual(["https://example.com/1.jpg"]);
  });

  it("hands over only the public fields", () => {
    const [only] = selectSessionScraps([scrap(1, { contentHash: "hash" })], { now: NOW }).scraps;
    expect(Object.keys(only).sort()).toEqual(
      ["capturedAt", "height", "id", "pageUrl", "src", "width"].sort(),
    );
  });

  it("caps the answer", () => {
    const many = Array.from({ length: SESSION_SCRAP_LIMIT + 20 }, (_, i) => scrap(i * 0.1));
    expect(selectSessionScraps(many, { now: NOW }).scraps).toHaveLength(SESSION_SCRAP_LIMIT);
  });

  it("answers an empty session with no window", () => {
    expect(selectSessionScraps([], { now: NOW })).toEqual({ scraps: [], window: null });
    expect(SESSION_GAP_MS).toBeGreaterThan(0);
  });
});

describe("session scraps bridge", () => {
  it("serves playhtml.fun event pages only, and local pages only when allowed", () => {
    expect(isSessionScrapsPageUrl("https://playhtml.fun/events/walking-together/session.html?session=x")).toBe(true);
    expect(isSessionScrapsPageUrl("https://playhtml.fun/fridge.html")).toBe(false);
    expect(isSessionScrapsPageUrl("https://evil.example/events/")).toBe(false);
    expect(isSessionScrapsPageUrl("http://playhtml.fun/events/")).toBe(false);
    expect(isSessionScrapsPageUrl("http://localhost:5173/events/")).toBe(false);
    expect(isSessionScrapsPageUrl("http://localhost:5173/events/", true)).toBe(true);
    expect(isSessionScrapsPageUrl("https://localhost/events/", true)).toBe(false);
  });

  it("recognizes only well-formed requests", () => {
    const base = { source: SESSION_SCRAPS_BRIDGE_SOURCE, type: SESSION_SCRAPS_REQUEST, requestId: "r" };
    expect(isSessionScrapsRequest(base)).toBe(true);
    expect(isSessionScrapsRequest({ ...base, since: NOW })).toBe(true);
    expect(isSessionScrapsRequest({ ...base, since: "yesterday" })).toBe(false);
    expect(isSessionScrapsRequest({ ...base, requestId: 1 })).toBe(false);
    expect(isSessionScrapsRequest({ ...base, source: "other" })).toBe(false);
  });
});
