// ABOUTME: Verifies how recent navigation events become internet commute stops.
// ABOUTME: Covers URL cleanup, recency ordering, deduplication, and unsafe schemes.

import { describe, expect, it } from "vitest";
import type { CollectionEvent } from "@movement/types";
import {
  curateCommuteStops,
  deriveRecentStops,
  formatStopAge,
  getFaviconUrl,
  getStopDisplayDetail,
  getStopDisplayName,
  parseRecentCommuteStops,
  SAMPLE_STOPS,
  type CommuteStop,
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

function commuteStop(
  domain: string,
  overrides: Partial<CommuteStop> = {},
): CommuteStop {
  return {
    ...SAMPLE_STOPS[0],
    id: `https://${domain}/interesting`,
    url: `https://${domain}/interesting`,
    domain,
    path: "/interesting",
    title: "An interesting page",
    source: "live",
    ...overrides,
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
        title: null,
        faviconUrl: null,
        recentDomainVisits: 1,
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
        title: null,
        faviconUrl: null,
        recentDomainVisits: 2,
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
        title: null,
        faviconUrl: null,
        recentDomainVisits: 1,
        visitedBy: "rider",
        visitedAt: 2,
        sampleAge: null,
        hue: "#4a9a8a",
        source: "live",
      },
    ]);
  });

  it("counts every domain visit before limiting the unique page pool", () => {
    const stops = deriveRecentStops(
      [
        navigationEvent("common-old", "https://common.example/one", 1),
        navigationEvent("common-middle", "https://common.example/two", 2),
        navigationEvent("common-new", "https://common.example/one", 3),
        navigationEvent("rare", "https://rare.example/place", 4),
      ],
      2,
    );

    expect(
      stops.map((stop) => ({
        domain: stop.domain,
        recentDomainVisits: stop.recentDomainVisits,
      })),
    ).toEqual([
      { domain: "rare.example", recentDomainVisits: 1 },
      { domain: "common.example", recentDomainVisits: 3 },
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
      title: "Walking through a strange garden",
    });

    expect(parseRecentCommuteStops([event])).toEqual([
      {
        id: "https://garden.example/paths/one",
        url: "https://garden.example/paths/one",
        domain: "garden.example",
        path: "/paths/one",
        title: "Walking through a strange garden",
        faviconUrl: "https://garden.example/leaf.svg",
        recentDomainVisits: 1,
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

describe("curateCommuteStops", () => {
  it("keeps excluded destinations in the source pool but not the landing route", () => {
    const candidates = [
      commuteStop("x.com"),
      commuteStop("gemini.google.com"),
      commuteStop("small-web.example"),
    ];

    expect(curateCommuteStops(candidates).map((stop) => stop.domain)).toEqual([
      "small-web.example",
    ]);
    expect(candidates.map((stop) => stop.domain)).toEqual([
      "x.com",
      "gemini.google.com",
      "small-web.example",
    ]);
  });

  it("rejects utility pages and untitled pages on content platforms", () => {
    expect(
      curateCommuteStops([
        commuteStop("interesting.example", { path: "/home" }),
        commuteStop("challenge.example", { title: "Just a moment..." }),
        commuteStop("youtube.com", { title: null, path: "/watch" }),
        commuteStop("youtube.com", {
          id: "https://youtube.com/watch/one",
          url: "https://youtube.com/watch/one",
          title: "A handmade corner of the web",
          path: "/watch/one",
        }),
      ]).map((stop) => stop.url),
    ).toEqual(["https://youtube.com/watch/one"]);
  });

  it("limits a route to one stop per domain and two stops per rider", () => {
    const route = curateCommuteStops([
      commuteStop("one.example", { visitedBy: "same-rider" }),
      commuteStop("one.example", {
        id: "https://one.example/other",
        url: "https://one.example/other",
        path: "/other",
        visitedBy: "other-rider",
      }),
      commuteStop("two.example", { visitedBy: "same-rider" }),
      commuteStop("three.example", { visitedBy: "same-rider" }),
      commuteStop("four.example", { visitedBy: "other-rider" }),
    ]);

    expect(route.map((stop) => stop.domain)).toEqual([
      "one.example",
      "two.example",
      "four.example",
    ]);
  });

  it("ranks less-visited domains first and uses recency to break ties", () => {
    const route = curateCommuteStops([
      commuteStop("popular.example", {
        recentDomainVisits: 8,
        visitedAt: 300,
        visitedBy: "popular-rider",
      }),
      commuteStop("older-rare.example", {
        recentDomainVisits: 1,
        visitedAt: 100,
        visitedBy: "older-rider",
      }),
      commuteStop("newer-rare.example", {
        recentDomainVisits: 1,
        visitedAt: 200,
        visitedBy: "newer-rider",
      }),
    ]);

    expect(route.map((stop) => stop.domain)).toEqual([
      "newer-rare.example",
      "older-rare.example",
      "popular.example",
    ]);
  });
});

describe("station labels", () => {
  it("uses a meaningful title with the domain and path as context", () => {
    const stop = commuteStop("video.example", {
      path: "/watch/one",
      title: "The web page that only appears at night",
    });

    expect(getStopDisplayName(stop)).toBe(
      "The web page that only appears at night",
    );
    expect(getStopDisplayDetail(stop)).toBe("video.example/watch/one");
  });

  it("falls back to the domain for generic or redundant titles", () => {
    expect(
      getStopDisplayName(
        commuteStop("youtube.com", { path: "/", title: "YouTube" }),
      ),
    ).toBe("youtube.com");
    expect(
      getStopDisplayDetail(
        commuteStop("youtube.com", { path: "/", title: "YouTube" }),
      ),
    ).toBe("front page");
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
