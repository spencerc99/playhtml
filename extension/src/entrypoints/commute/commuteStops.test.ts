// ABOUTME: Verifies how recent navigation events become internet commute stops.
// ABOUTME: Covers URL cleanup, recency ordering, deduplication, and unsafe schemes.

import { describe, expect, it } from "vitest";
import type { CollectionEvent } from "@movement/types";
import {
  deriveRecentStops,
  formatStopAge,
  getFaviconUrl,
  parseRecentCommuteStops,
  SAMPLE_STOPS,
} from "./commuteStops";

function navigationEvent(
  id: string,
  url: string,
  ts: number,
  normalizedUrl?: string,
): CollectionEvent {
  return {
    id,
    type: "navigation",
    ts,
    data: { x: 0, y: 0 },
    normalizedUrl,
    meta: {
      pid: "rider",
      sid: "trip",
      url,
      vw: 1200,
      vh: 800,
      tz: "UTC",
    },
  };
}

describe("deriveRecentStops", () => {
  it("returns the newest unique web pages without query strings or hashes", () => {
    const stops = deriveRecentStops([
      navigationEvent("1", "https://slow.example/first?private=1", 1),
      navigationEvent("2", "https://slow.example/first?private=2", 2),
      navigationEvent("3", "https://www.next.example/path#section", 3),
    ]);

    expect(stops).toEqual([
      {
        id: "https://www.next.example/path",
        url: "https://www.next.example/path",
        domain: "next.example",
        path: "/path",
        faviconUrl: null,
        visitedBy: "rider",
        visitedAt: 3,
        sampleAge: null,
        hue: "#4a9a8a",
        source: "live",
      },
      {
        id: "https://slow.example/first",
        url: "https://slow.example/first",
        domain: "slow.example",
        path: "/first",
        faviconUrl: null,
        visitedBy: "rider",
        visitedAt: 2,
        sampleAge: null,
        hue: "#4a9a8a",
        source: "live",
      },
    ]);
  });

  it("prefers normalized URLs and ignores non-navigation or non-web events", () => {
    const keyboard = navigationEvent("keyboard", "https://typing.example/", 4);
    keyboard.type = "keyboard";

    expect(
      deriveRecentStops([
        keyboard,
        navigationEvent("unsafe", "chrome://settings/", 3),
        navigationEvent(
          "normalized",
          "https://raw.example/?search=secret",
          2,
          "https://public.example/place",
        ),
      ]),
    ).toEqual([
      {
        id: "https://public.example/place",
        url: "https://public.example/place",
        domain: "public.example",
        path: "/place",
        faviconUrl: null,
        visitedBy: "rider",
        visitedAt: 2,
        sampleAge: null,
        hue: "#4a9a8a",
        source: "live",
      },
    ]);
  });
});

describe("getFaviconUrl", () => {
  it("uses the first-party origin for live destinations", () => {
    expect(
      getFaviconUrl({
        domain: "neal.fun",
        faviconUrl: null,
        source: "live",
        url: "https://neal.fun/deep-sea/",
      }),
    ).toBe("https://neal.fun/favicon.ico");
  });

  it("uses known favicon images for the public sample route", () => {
    expect(getFaviconUrl(SAMPLE_STOPS[0])).toBe(
      "https://www.google.com/s2/favicons?domain=html.energy&sz=64",
    );
  });

  it("prefers favicon metadata returned with a recent navigation", () => {
    expect(
      getFaviconUrl({
        domain: "neal.fun",
        faviconUrl: "https://neal.fun/icon.png",
        source: "live",
        url: "https://neal.fun/deep-sea/",
      }),
    ).toBe("https://neal.fun/icon.png");
  });
});

describe("parseRecentCommuteStops", () => {
  it("turns the worker response into a recent route with favicon metadata", () => {
    const event = navigationEvent(
      "live",
      "https://garden.example/paths/one?private=secret",
      100,
    );
    Object.assign(event.data, {
      favicon_url: "https://garden.example/leaf.svg",
    });

    expect(parseRecentCommuteStops([event])).toEqual([
      {
        id: "https://garden.example/paths/one",
        url: "https://garden.example/paths/one",
        domain: "garden.example",
        path: "/paths/one",
        faviconUrl: "https://garden.example/leaf.svg",
        visitedBy: "rider",
        visitedAt: 100,
        sampleAge: null,
        hue: "#4a9a8a",
        source: "live",
      },
    ]);
  });

  it("rejects malformed recent navigation responses", () => {
    expect(() => parseRecentCommuteStops({ events: [] })).toThrow(
      "Recent navigation response must be an array",
    );
  });
});

describe("formatStopAge", () => {
  it("formats live visit age against the supplied clock", () => {
    expect(
      formatStopAge(
        {
          ...SAMPLE_STOPS[0],
          visitedAt: 940_000,
          sampleAge: null,
          source: "live",
        },
        1_000_000,
      ),
    ).toBe("1m");
  });

  it("keeps the authored sample age", () => {
    expect(formatStopAge(SAMPLE_STOPS[0], 1_000_000)).toBe("3m");
  });
});
