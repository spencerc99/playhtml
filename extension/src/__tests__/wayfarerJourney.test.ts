// ABOUTME: Covers the wayfarer journey helpers: URL canonicalization, dedup, cap, and tolerant parsing.
// ABOUTME: The journey is what the map walks, so a bad stop here becomes a walker going nowhere.

import { describe, expect, it } from "vitest";
import {
  JOURNEY_CAP,
  appendStop,
  emptyJourney,
  normalizeJourney,
  normalizeStopUrl,
  normalizeWidgetState,
  type Journey,
} from "../features/wayfarer/journey";

describe("normalizeStopUrl", () => {
  it("drops the query and hash but keeps origin and path", () => {
    expect(normalizeStopUrl("https://example.com/a/b?x=1#frag")).toBe(
      "https://example.com/a/b",
    );
  });

  it("lowercases the host and strips a trailing slash except at the root", () => {
    expect(normalizeStopUrl("https://EXAMPLE.com/Docs/")).toBe(
      "https://example.com/Docs",
    );
    expect(normalizeStopUrl("https://example.com/")).toBe("https://example.com/");
    expect(normalizeStopUrl("https://example.com")).toBe("https://example.com/");
  });

  it("keeps the port in the origin", () => {
    expect(normalizeStopUrl("http://github.com:18791/foo")).toBe(
      "http://github.com:18791/foo",
    );
  });

  it("rejects anything that is not an http(s) page", () => {
    expect(normalizeStopUrl("chrome-extension://abc/wayfarer.html")).toBeNull();
    expect(normalizeStopUrl("about:blank")).toBeNull();
    expect(normalizeStopUrl("file:///Users/me/page.html")).toBeNull();
    expect(normalizeStopUrl("data:text/html,hi")).toBeNull();
    expect(normalizeStopUrl("not a url")).toBeNull();
    expect(normalizeStopUrl("")).toBeNull();
  });
});

describe("appendStop", () => {
  it("appends a normalized stop with a trimmed title", () => {
    const next = appendStop(
      emptyJourney(),
      { url: "https://example.com/a?q=1", title: "  A page  " },
      1000,
    );
    expect(next.stops).toEqual([
      { url: "https://example.com/a", title: "A page", ts: 1000 },
    ]);
    expect(next.updatedAt).toBe(1000);
  });

  it("caps the title at 120 characters and defaults it to empty", () => {
    const long = appendStop(
      emptyJourney(),
      { url: "https://example.com/a", title: "x".repeat(200) },
      1,
    );
    expect(long.stops[0].title).toHaveLength(120);

    const untitled = appendStop(emptyJourney(), { url: "https://example.com/b" }, 2);
    expect(untitled.stops[0].title).toBe("");
  });

  it("refreshes the current stop instead of duplicating it", () => {
    const first = appendStop(
      emptyJourney(),
      { url: "https://example.com/a", title: "First" },
      1000,
    );
    const second = appendStop(
      first,
      { url: "https://example.com/a?utm=x#top", title: "Second" },
      2000,
    );
    expect(second.stops).toEqual([
      { url: "https://example.com/a", title: "Second", ts: 2000 },
    ]);
  });

  it("keeps an earlier title when the revisit has none", () => {
    const first = appendStop(
      emptyJourney(),
      { url: "https://example.com/a", title: "First" },
      1,
    );
    const second = appendStop(first, { url: "https://example.com/a" }, 2);
    expect(second.stops[0].title).toBe("First");
  });

  it("leaves the journey untouched for a url it cannot normalize", () => {
    const journey = appendStop(emptyJourney(), { url: "https://example.com/a" }, 1);
    expect(appendStop(journey, { url: "about:blank" }, 2)).toBe(journey);
  });

  it("keeps only the newest stops", () => {
    let journey = emptyJourney();
    for (let i = 0; i < JOURNEY_CAP + 8; i += 1) {
      journey = appendStop(journey, { url: `https://example.com/${i}` }, i);
    }
    expect(journey.stops).toHaveLength(JOURNEY_CAP);
    expect(journey.stops[0].url).toBe("https://example.com/8");
    expect(journey.stops[JOURNEY_CAP - 1].url).toBe(
      `https://example.com/${JOURNEY_CAP + 7}`,
    );
  });
});

describe("normalizeJourney", () => {
  it("returns an empty journey for garbage", () => {
    expect(normalizeJourney(undefined)).toEqual({ stops: [], updatedAt: 0 });
    expect(normalizeJourney("nope")).toEqual({ stops: [], updatedAt: 0 });
    expect(normalizeJourney({ stops: "nope" })).toEqual({ stops: [], updatedAt: 0 });
  });

  it("keeps usable stops and drops the rest", () => {
    const parsed = normalizeJourney({
      stops: [
        { url: "https://example.com/a/", title: "A", ts: 5 },
        { url: "about:blank", title: "B", ts: 6 },
        { url: "https://example.com/b", title: 42 },
        null,
      ],
      updatedAt: 7,
    });
    expect(parsed).toEqual({
      stops: [
        { url: "https://example.com/a", title: "A", ts: 5 },
        { url: "https://example.com/b", title: "", ts: 0 },
      ],
      updatedAt: 7,
    });
  });

  it("round-trips an appended journey", () => {
    const journey: Journey = appendStop(
      emptyJourney(),
      { url: "https://example.com/a", title: "A" },
      9,
    );
    expect(normalizeJourney(JSON.parse(JSON.stringify(journey)))).toEqual(journey);
  });
});

describe("normalizeWidgetState", () => {
  it("defaults to expanded and only trusts a literal true", () => {
    expect(normalizeWidgetState(undefined)).toEqual({ collapsed: false });
    expect(normalizeWidgetState({ collapsed: "yes" })).toEqual({ collapsed: false });
    expect(normalizeWidgetState({ collapsed: true })).toEqual({ collapsed: true });
  });
});
