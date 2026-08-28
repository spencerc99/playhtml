// ABOUTME: Tests hosted train boarding requests, response parsing, and stop mapping.
// ABOUTME: Protects the privacy boundary between local Slow Mode rides and public routes.

import { describe, expect, it } from "vitest";
import type { CommuteTrainAssignment } from "@playhtml/extension-types";
import {
  createCommuteTrainBoardRequest,
  getCommuteTrainNextAction,
  getCommuteRiderToken,
  getCommuteTrainTimeOffset,
  parseCommuteTrainAssignment,
  rotateCommuteRiderToken,
  toCommuteStop,
} from "./commuteTrain";

const assignment: CommuteTrainAssignment = {
  trainId: "train-1",
  createdAt: 1_000,
  departureAt: 6_000,
  joinableUntil: 61_000,
  routeEndsAt: 80_000,
  routeVersion: 2,
  riderCount: 2,
  capacity: 4,
  joinable: true,
  phase: "riding",
  serverNow: 10_100,
  stops: [
    {
      kind: "domain",
      id: "stop-1",
      domain: "example.com",
      url: "https://example.com/",
      hue: "#4a9a8a",
      claimantCount: 2,
    },
  ],
};

describe("commute train client", () => {
  it("uses dispatcher-safe stable tokens", () => {
    const rideToken = getCommuteRiderToken({
      rideId: "8cc8e2ef-63cf-4cb6-86c7-6d4999e5641d",
      destinationDomain: "example.com",
      stopVisibility: "domain",
    });
    expect(rideToken).toBe("slow_8cc8e2ef-63cf-4cb6-86c7-6d4999e5641d");
    expect(rideToken).toMatch(/^[a-zA-Z0-9_-]{16,128}$/);

    const firstWebToken = getCommuteRiderToken(null);
    expect(getCommuteRiderToken(null)).toBe(firstWebToken);
    expect(firstWebToken).toMatch(/^[a-zA-Z0-9_-]{16,128}$/);
  });

  it("rotates the standard rider token for the next trip", () => {
    const firstToken = getCommuteRiderToken(null);
    const nextToken = rotateCommuteRiderToken();

    expect(nextToken).not.toBe(firstToken);
    expect(getCommuteRiderToken(null)).toBe(nextToken);
  });

  it("refreshes open trains and reboards riders after completion", () => {
    expect(getCommuteTrainNextAction(assignment)).toEqual({
      kind: "refresh",
      delayMs: 3_000,
    });
    expect(
      getCommuteTrainNextAction(
        { ...assignment, joinable: false, serverNow: 75_000 },
      ),
    ).toEqual({ kind: "reboard", delayMs: 5_000 });
    expect(
      getCommuteTrainNextAction(
        { ...assignment, joinable: false, serverNow: 85_000, phase: "complete" },
      ),
    ).toEqual({ kind: "reboard", delayMs: 0 });
  });

  it("shares only a domain stop when the rider allows it", () => {
    expect(
      createCommuteTrainBoardRequest("slow_ride-1", {
        rideId: "ride-1",
        destinationDomain: "example.com",
        stopVisibility: "domain",
      }),
    ).toEqual({
      riderToken: "slow_ride-1",
      requestedStop: { kind: "domain", domain: "example.com" },
    });
  });

  it("does not send a destination for private rides", () => {
    expect(
      createCommuteTrainBoardRequest("slow_ride-1", {
        rideId: "ride-1",
        destinationDomain: "example.com",
        stopVisibility: "private",
      }),
    ).toEqual({ riderToken: "slow_ride-1", requestedStop: { kind: "none" } });
  });

  it("parses assignments and maps public domain stops", () => {
    expect(parseCommuteTrainAssignment(assignment)).toEqual(assignment);
    expect(toCommuteStop(assignment.stops[0])).toMatchObject({
      domain: "example.com",
      url: "https://example.com/",
      recentDomainVisits: 2,
    });
    expect(() => parseCommuteTrainAssignment({ trainId: "incomplete" })).toThrow(
      "Invalid commute train assignment",
    );
    expect(() =>
      parseCommuteTrainAssignment({
        ...assignment,
        stops: [{ ...assignment.stops[0], claimantCount: undefined }],
      }),
    ).toThrow("Invalid commute train assignment");
  });

  it("estimates server time at the request midpoint", () => {
    expect(getCommuteTrainTimeOffset(assignment, 10_000, 10_100)).toBe(50);
  });
});
