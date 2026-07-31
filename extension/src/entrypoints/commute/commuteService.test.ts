// ABOUTME: Verifies Internet Commute riders converge on one ephemeral train service.
// ABOUTME: Covers canonical selection, malformed presence, route snapshots, and clock offset.

import { describe, expect, it } from "vitest";
import { SAMPLE_STOPS } from "./commuteStops";
import {
  COMMUTE_SERVICE_CHANNEL,
  createCommuteService,
  estimateServerTimeOffset,
  getCommuteServiceFromPresence,
  selectCommuteService,
} from "./commuteService";

function presenceFor(service: ReturnType<typeof createCommuteService>) {
  return {
    [COMMUTE_SERVICE_CHANNEL]: {
      joinedAt: service.startedAt,
      service,
    },
  };
}

describe("Internet Commute service", () => {
  it("creates a route snapshot that does not follow later local mutations", () => {
    const stops = SAMPLE_STOPS.slice(0, 2).map((stop) => ({ ...stop }));
    const service = createCommuteService(1_000, "rider-a", stops);

    stops[0].domain = "changed.example";

    expect(service.id).toBe("1000:rider-a");
    expect(service.stops[0].domain).toBe(SAMPLE_STOPS[0].domain);
  });

  it("selects the earliest valid active service", () => {
    const first = createCommuteService(1_000, "rider-a", SAMPLE_STOPS);
    const later = createCommuteService(1_100, "rider-b", SAMPLE_STOPS);

    expect(
      selectCommuteService([
        presenceFor(later),
        { [COMMUTE_SERVICE_CHANNEL]: { service: null } },
        presenceFor(first),
      ]),
    ).toEqual(first);
  });

  it("uses the service id as a deterministic simultaneous-start tiebreaker", () => {
    const serviceB = createCommuteService(1_000, "rider-b", SAMPLE_STOPS);
    const serviceA = createCommuteService(1_000, "rider-a", SAMPLE_STOPS);

    expect(
      selectCommuteService([presenceFor(serviceB), presenceFor(serviceA)])?.id,
    ).toBe(serviceA.id);
  });

  it("ignores malformed route data from presence", () => {
    const malformed = {
      [COMMUTE_SERVICE_CHANNEL]: {
        joinedAt: 1_000,
        service: {
          id: "bad",
          startedAt: 1_000,
          stops: [{ id: "missing-fields" }],
        },
      },
    };

    expect(getCommuteServiceFromPresence(malformed)).toBeNull();
    expect(selectCommuteService([malformed])).toBeNull();
  });

  it("calibrates from receipt because generatedAt is set after route work", () => {
    expect(estimateServerTimeOffset(10_100, 9_900, 10_150)).toBe(-50);
  });

  it("rejects an inverted request interval", () => {
    expect(() => estimateServerTimeOffset(10_000, 10_100, 10_000)).toThrow(
      "Internet Commute response preceded its request",
    );
  });
});
