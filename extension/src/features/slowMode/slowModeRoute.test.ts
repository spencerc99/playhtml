// ABOUTME: Verifies personalized Slow Mode routes preserve their destination terminus.
// ABOUTME: Covers stop count, deduplication, history avoidance, and request parsing.

import { describe, expect, it } from "vitest";
import { SAMPLE_STOPS, type CommuteStop } from "../../entrypoints/commute/commuteStops";
import {
  buildSlowModeRoute,
  parseSlowModeRequest,
} from "./slowModeRoute";

describe("Slow Mode route construction", () => {
  it("adds the destination after the requested number of intermediate stops", () => {
    const route = buildSlowModeRoute(
      SAMPLE_STOPS,
      "https://museum.example/exhibit?utm_source=train",
      3,
      [],
      () => 0,
    );

    expect(route).toHaveLength(4);
    expect(route.at(-1)).toMatchObject({
      domain: "museum.example",
      url: "https://museum.example/exhibit",
    });
  });

  it("avoids the destination and recent rider domains among intermediate stops", () => {
    const destinationStop: CommuteStop = {
      ...SAMPLE_STOPS[0],
      id: "destination-duplicate",
      url: "https://museum.example/other",
      domain: "museum.example",
    };
    const route = buildSlowModeRoute(
      [destinationStop, ...SAMPLE_STOPS],
      "https://museum.example/exhibit",
      2,
      ["html.energy"],
      () => 0,
    );

    expect(route.slice(0, -1).map((stop) => stop.domain)).not.toContain(
      "museum.example",
    );
    expect(route.slice(0, -1).map((stop) => stop.domain)).not.toContain(
      "html.energy",
    );
  });

  it("parses a complete interception request", () => {
    expect(
      parseSlowModeRequest(
        "?slow=1&destination=https%3A%2F%2Fmuseum.example%2Fexhibit&ride=123%3Amuseum.example&stops=3",
      ),
    ).toEqual({
      destinationUrl: "https://museum.example/exhibit",
      rideId: "123:museum.example",
      stopCount: 3,
    });
  });

  it("strips tracking parameters from the preserved destination", () => {
    expect(
      parseSlowModeRequest(
        "?slow=1&destination=https%3A%2F%2Fmuseum.example%2Fexhibit%3Futm_source%3Dtrain%26item%3D1&ride=123%3Amuseum.example&stops=2",
      )?.destinationUrl,
    ).toBe("https://museum.example/exhibit?item=1");
  });

  it("rejects incomplete or non-web requests", () => {
    expect(parseSlowModeRequest("?slow=1&destination=javascript:alert(1)"))
      .toBeNull();
    expect(parseSlowModeRequest("?destination=https://museum.example"))
      .toBeNull();
  });
});
