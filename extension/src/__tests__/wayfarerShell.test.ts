// ABOUTME: Covers the wayfarer shell's message protocol and URL building.
// ABOUTME: The shell is the only thing between the map frame and the extension, so it stays strict.

import { describe, expect, it } from "vitest";
import {
  buildJourneyMessage,
  buildWidgetSrc,
  isMapMessage,
  mapOrigin,
  openMapUrl,
} from "../features/wayfarer/shell";
import { appendStop, emptyJourney } from "../features/wayfarer/journey";

describe("buildWidgetSrc", () => {
  it("adds the widget flag to a plain base url", () => {
    expect(buildWidgetSrc("https://wewere.online/internet-map/")).toBe(
      "https://wewere.online/internet-map/?widget=1",
    );
  });

  it("appends to a base url that already has a query", () => {
    expect(buildWidgetSrc("http://127.0.0.1:18790/internet-map/?seed=3")).toBe(
      "http://127.0.0.1:18790/internet-map/?seed=3&widget=1",
    );
  });
});

describe("mapOrigin", () => {
  it("returns the origin the map frame posts from", () => {
    expect(mapOrigin("https://wewere.online/internet-map/")).toBe(
      "https://wewere.online",
    );
    expect(mapOrigin("http://127.0.0.1:18790/internet-map/")).toBe(
      "http://127.0.0.1:18790",
    );
  });
});

describe("isMapMessage", () => {
  it("accepts ready and well-formed status messages", () => {
    expect(isMapMessage({ source: "wwo-internet-map", type: "ready" })).toBe(true);
    expect(
      isMapMessage({
        source: "wwo-internet-map",
        type: "status",
        state: "walking",
        place: { name: "example.com/a", host: "example.com", domain: "example.com" },
        text: "walking to example.com",
      }),
    ).toBe(true);
    expect(
      isMapMessage({
        source: "wwo-internet-map",
        type: "status",
        state: "lost",
        place: null,
        text: "lost the road",
      }),
    ).toBe(true);
  });

  it("rejects anything else", () => {
    expect(isMapMessage(null)).toBe(false);
    expect(isMapMessage("ready")).toBe(false);
    expect(isMapMessage({ source: "somewhere-else", type: "ready" })).toBe(false);
    expect(isMapMessage({ source: "wwo-internet-map", type: "navigate" })).toBe(false);
    expect(
      isMapMessage({
        source: "wwo-internet-map",
        type: "status",
        state: "dancing",
        place: null,
        text: "hi",
      }),
    ).toBe(false);
    expect(
      isMapMessage({
        source: "wwo-internet-map",
        type: "status",
        state: "arrived",
        place: { name: "example.com" },
        text: "hi",
      }),
    ).toBe(false);
    expect(
      isMapMessage({
        source: "wwo-internet-map",
        type: "status",
        state: "arrived",
        place: null,
      }),
    ).toBe(false);
  });
});

describe("buildJourneyMessage", () => {
  it("sends the whole stop list oldest first", () => {
    let journey = appendStop(emptyJourney(), { url: "https://a.com/1", title: "A" }, 1);
    journey = appendStop(journey, { url: "https://b.com/2", title: "B" }, 2);

    expect(buildJourneyMessage(journey)).toEqual({
      source: "wwo-wayfarer",
      type: "journey",
      stops: [
        { url: "https://a.com/1", title: "A", ts: 1 },
        { url: "https://b.com/2", title: "B", ts: 2 },
      ],
    });
  });
});

describe("openMapUrl", () => {
  it("uses the newest stop's host as the query", () => {
    let journey = appendStop(emptyJourney(), { url: "https://a.com/1" }, 1);
    journey = appendStop(journey, { url: "https://docs.b.com:8443/2" }, 2);

    expect(openMapUrl("https://wewere.online/internet-map/", journey)).toBe(
      "https://wewere.online/internet-map/?walk=1&q=docs.b.com",
    );
  });

  it("omits the query when there is nowhere to go yet", () => {
    expect(openMapUrl("https://wewere.online/internet-map/", emptyJourney())).toBe(
      "https://wewere.online/internet-map/?walk=1",
    );
  });

  it("appends to a base url that already has a query", () => {
    const journey = appendStop(emptyJourney(), { url: "https://a.com/1" }, 1);
    expect(openMapUrl("http://127.0.0.1:18790/internet-map/?seed=3", journey)).toBe(
      "http://127.0.0.1:18790/internet-map/?seed=3&walk=1&q=a.com",
    );
  });
});
