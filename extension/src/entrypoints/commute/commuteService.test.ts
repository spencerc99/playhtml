// ABOUTME: Verifies Internet Commute riders converge on one ephemeral train service.
// ABOUTME: Covers canonical selection, malformed presence, route snapshots, and clock offset.

import { describe, expect, it } from "vitest";
import { SAMPLE_STOPS } from "./commuteStops";
import {
  COMMUTE_SERVICE_CHANNEL,
  createCommuteService,
  getCommuteServicesFromPresences,
  getCommuteStops,
  getCommuteServiceFromPresence,
  selectCommuteService,
} from "./commuteService";

function presenceFor(service: ReturnType<typeof createCommuteService>) {
  return {
    [COMMUTE_SERVICE_CHANNEL]: {
      service,
    },
  };
}

describe("Internet Commute service", () => {
  it("creates a route snapshot that does not follow later local mutations", () => {
    const stops = SAMPLE_STOPS.slice(0, 2).map((stop) => ({ ...stop }));
    const service = createCommuteService(1_000, "rider-a", stops);

    stops[0].title = "changed title";

    expect(service.id).toBe("1000:rider-a");
    expect(service.stops[0].title).toBe(SAMPLE_STOPS[0].title);
  });

  it("selects the earliest valid active service", () => {
    const first = createCommuteService(1_000, "rider-a", SAMPLE_STOPS);
    const later = createCommuteService(1_100, "rider-b", SAMPLE_STOPS);

    expect(
      selectCommuteService([later, first]),
    ).toEqual(first);
  });

  it("uses the service id as a deterministic simultaneous-start tiebreaker", () => {
    const serviceB = createCommuteService(1_000, "rider-b", SAMPLE_STOPS);
    const serviceA = createCommuteService(1_000, "rider-a", SAMPLE_STOPS);

    expect(
      selectCommuteService([serviceB, serviceA])?.id,
    ).toBe(serviceA.id);
  });

  it("ignores malformed route data from presence", () => {
    const valid = createCommuteService(1_000, "rider-a", SAMPLE_STOPS);
    const malformed = {
      [COMMUTE_SERVICE_CHANNEL]: {
        service: {
          id: "bad",
          startedAt: 1_000,
          stops: [{ id: "missing-fields" }],
        },
      },
    };

    expect(getCommuteServiceFromPresence(malformed)).toBeNull();
    expect(
      getCommuteServicesFromPresences([malformed, presenceFor(valid)]),
    ).toEqual([valid]);
  });

  it("reconstructs display stops from the compact service route", () => {
    const service = createCommuteService(1_000, "rider-a", [
      {
        ...SAMPLE_STOPS[0],
        url: "https://www.example.com/a-page",
        title: "A page",
      },
    ]);

    expect(getCommuteStops(service)[0]).toMatchObject({
      id: "https://www.example.com/a-page",
      domain: "example.com",
      path: "/a-page",
      title: "A page",
      source: "sample",
    });
  });

  it("keeps a ten-stop route below the PlayHTML presence value limit", () => {
    const stops = Array.from({ length: 10 }, (_, index) => ({
      ...SAMPLE_STOPS[0],
      url: `https://destination-${index}.example/${"path/".repeat(20)}`,
      title: "T".repeat(100),
      visitedAt: 1_000 + index,
      sampleAge: null,
      source: "live" as const,
    }));
    const service = createCommuteService(
      1_000,
      `pk_${"a".repeat(130)}`,
      stops,
    );
    const wireValue = {
      at: 1_000,
      value: { service },
    };
    const bytes = new TextEncoder().encode(JSON.stringify(wireValue)).byteLength;

    expect(bytes).toBeLessThanOrEqual(4_096);
  });
});
