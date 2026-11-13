// ABOUTME: Verifies how the commute API response becomes internet commute stops.
// ABOUTME: Covers scenery rotation, favicons, response parsing, labels, and stop ages.

import { describe, expect, it } from "vitest";
import {
  formatStopAge,
  getFaviconUrl,
  getPassingSceneryStops,
  getStopDisplayDetail,
  getStopDisplayName,
  parseCommuteResponse,
  SAMPLE_STOPS,
  type CommuteStop,
} from "./commuteStops";

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

describe("getPassingSceneryStops", () => {
  it("rotates the visible domains for each stop and omits the current domain", () => {
    const stops = [
      commuteStop("current.example"),
      ...Array.from({ length: 9 }, (_, index) =>
        commuteStop(`scenery-${index}.example`),
      ),
    ];

    expect(
      getPassingSceneryStops(stops, "current.example", 0).map(
        (stop) => stop.domain,
      ),
    ).toEqual([
      "scenery-0.example",
      "scenery-1.example",
      "scenery-2.example",
      "scenery-3.example",
    ]);
    expect(
      getPassingSceneryStops(stops, "current.example", 1).map(
        (stop) => stop.domain,
      ),
    ).toEqual([
      "scenery-4.example",
      "scenery-5.example",
      "scenery-6.example",
      "scenery-7.example",
    ]);
  });
});

describe("getFaviconUrl", () => {
  it("uses the public favicon service for live destinations without metadata", () => {
    expect(
      getFaviconUrl({
        domain: "neal.fun",
        faviconUrl: null,
      }),
    ).toBe("https://www.google.com/s2/favicons?domain=neal.fun&sz=64");
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
      }),
    ).toBe("https://neal.fun/icon.png");
  });
});

describe("parseCommuteResponse", () => {
  it("uses only the sanitized route and domain-only scenery", () => {
    expect(
      parseCommuteResponse({
        generatedAt: 1_000,
        activePeople: 4,
        scenery: [
          {
            id: "docs.google.com:900",
            domain: "docs.google.com",
            visitedAt: 900,
            hue: "#5b8db8",
          },
        ],
        destinations: [
          {
            id: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
            url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
            domain: "youtube.com",
            title: "A particular video",
            visitedAt: 800,
            hue: "#4a9a8a",
          },
        ],
      }),
    ).toEqual({
      activePeople: 4,
      generatedAt: 1_000,
      sceneryStops: [
        expect.objectContaining({
          domain: "docs.google.com",
          title: null,
          url: "https://docs.google.com/",
        }),
      ],
      stops: [
        expect.objectContaining({
          domain: "youtube.com",
          title: "A particular video",
          url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        }),
      ],
    });
  });

  it("rejects malformed sanitized responses", () => {
    expect(() => parseCommuteResponse({ destinations: [] })).toThrow(
      "Commute response is malformed",
    );
  });
});

describe("station labels", () => {
  it("uses a meaningful title with only the domain as context", () => {
    const stop = commuteStop("video.example", {
      path: "/watch/one",
      title: "The web page that only appears at night",
    });

    expect(getStopDisplayName(stop)).toBe(
      "The web page that only appears at night",
    );
    expect(getStopDisplayDetail(stop)).toBe("video.example");
  });

  it("falls back to the domain for generic or redundant titles", () => {
    expect(
      getStopDisplayName(
        commuteStop("youtube.com", { path: "/", title: "YouTube" }),
      ),
    ).toBe("youtube.com");
    expect(getStopDisplayDetail(commuteStop("youtube.com"))).toBe(
      "youtube.com",
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
