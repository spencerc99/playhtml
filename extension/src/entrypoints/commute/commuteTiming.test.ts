// ABOUTME: Verifies the train phase sequence and stop progression.
// ABOUTME: Covers the origin platform, travel, arrival, and destination dwell.

import { describe, expect, it } from "vitest";
import {
  getCommuteRouteDurationSeconds,
  getCommuteTiming,
} from "./commuteTiming";

describe("getCommuteTiming", () => {
  it("starts at the origin with open doors", () => {
    expect(getCommuteTiming(0, 5)).toEqual({
      phase: "stopped",
      secondsLeft: 10,
      stopIndex: 0,
      departureStopIndex: null,
      atOrigin: true,
      complete: false,
    });
  });

  it("keeps the initial Home Station platform open for ten seconds", () => {
    expect(getCommuteTiming(9.999, 5)).toMatchObject({
      phase: "stopped",
      stopIndex: 0,
      departureStopIndex: null,
      atOrigin: true,
    });
    expect(getCommuteTiming(9.999, 5).secondsLeft).toBeCloseTo(0.001);
    expect(getCommuteTiming(10, 5)).toEqual({
      phase: "riding",
      secondsLeft: 15,
      stopIndex: 0,
      departureStopIndex: null,
      atOrigin: false,
      complete: false,
    });
  });

  it("moves through travel, arrival, and a five-second destination dwell", () => {
    expect(getCommuteTiming(24.999, 5)).toMatchObject({
      phase: "riding",
      stopIndex: 0,
      departureStopIndex: null,
    });
    expect(getCommuteTiming(25, 5)).toEqual({
      phase: "arriving",
      secondsLeft: 4,
      stopIndex: 0,
      departureStopIndex: null,
      atOrigin: false,
      complete: false,
    });
    expect(getCommuteTiming(28.999, 5)).toMatchObject({
      phase: "arriving",
      stopIndex: 0,
      departureStopIndex: null,
    });
    expect(getCommuteTiming(29, 5)).toEqual({
      phase: "stopped",
      secondsLeft: 5,
      stopIndex: 0,
      departureStopIndex: null,
      atOrigin: false,
      complete: false,
    });
    expect(getCommuteTiming(33.999, 5)).toMatchObject({
      phase: "stopped",
      stopIndex: 0,
      departureStopIndex: null,
    });
  });

  it("keeps showing the departed stop through the platform departure", () => {
    expect(getCommuteTiming(34, 5)).toEqual({
      phase: "riding",
      secondsLeft: 15,
      stopIndex: 1,
      departureStopIndex: 0,
      atOrigin: false,
      complete: false,
    });
    expect(getCommuteTiming(36.599, 5)).toMatchObject({
      phase: "riding",
      stopIndex: 1,
      departureStopIndex: 0,
    });
    expect(getCommuteTiming(36.6, 5)).toMatchObject({
      phase: "riding",
      stopIndex: 1,
      departureStopIndex: null,
    });
  });

  it("completes the route after the final stop without wrapping", () => {
    expect(getCommuteTiming(57.999, 2)).toMatchObject({
      phase: "stopped",
      stopIndex: 1,
      atOrigin: false,
      complete: false,
    });
    expect(getCommuteTiming(58, 2)).toEqual({
      phase: "stopped",
      secondsLeft: 0,
      stopIndex: 1,
      departureStopIndex: null,
      atOrigin: true,
      complete: true,
    });
    expect(getCommuteTiming(500, 2)).toMatchObject({
      stopIndex: 1,
      complete: true,
    });
  });

  it("reports the finite duration of a route", () => {
    expect(getCommuteRouteDurationSeconds(2)).toBe(58);
  });

  it("rejects an empty route", () => {
    expect(() => getCommuteTiming(0, 0)).toThrow(
      "Internet Commute requires at least one stop",
    );
  });
});
