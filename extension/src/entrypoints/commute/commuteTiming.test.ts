// ABOUTME: Verifies the train phase sequence and stop progression.
// ABOUTME: Covers the origin platform, travel, arrival, and destination dwell.

import { describe, expect, it } from "vitest";
import {
  getCommuteRouteDurationSeconds,
  getSlowModePlatformPhase,
  getSlowModeProgress,
  getCommuteTiming,
  SLOW_MODE_DURATIONS,
} from "./commuteTiming";

describe("getCommuteTiming", () => {
  it("counts a stop after the train reaches it", () => {
    expect(
      getSlowModeProgress(
        { atOrigin: true, phase: "stopped", stopIndex: 0 },
        4,
      ),
    ).toEqual({ completedIndex: -1, stopsLeft: 3 });
    expect(
      getSlowModeProgress(
        { atOrigin: false, phase: "riding", stopIndex: 0 },
        4,
      ),
    ).toEqual({ completedIndex: -1, stopsLeft: 3 });
    expect(
      getSlowModeProgress(
        { atOrigin: false, phase: "stopped", stopIndex: 0 },
        4,
      ),
    ).toEqual({ completedIndex: 0, stopsLeft: 2 });
  });

  it("uses the Slow Mode platform, leg, and dwell durations", () => {
    expect(getCommuteTiming(8, 3, SLOW_MODE_DURATIONS)).toMatchObject({
      phase: "stopped",
      secondsLeft: 1,
      atOrigin: true,
    });
    expect(getCommuteTiming(9, 3, SLOW_MODE_DURATIONS)).toMatchObject({
      phase: "riding",
      secondsLeft: 12,
    });
    expect(getCommuteTiming(25, 3, SLOW_MODE_DURATIONS)).toMatchObject({
      phase: "stopped",
      secondsLeft: 8,
      stopIndex: 0,
    });
  });

  it("separates the Slow Mode train arrival from boarding", () => {
    expect(getSlowModePlatformPhase(9)).toBe("waiting");
    expect(getSlowModePlatformPhase(6)).toBe("arriving");
    expect(getSlowModePlatformPhase(4)).toBe("boarding");
  });
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
      phase: "riding",
      secondsLeft: 6,
      stopIndex: 1,
      departureStopIndex: 1,
      atOrigin: false,
      complete: true,
    });
    expect(getCommuteTiming(64, 2)).toEqual({
      phase: "arriving",
      secondsLeft: 4,
      stopIndex: 1,
      departureStopIndex: null,
      atOrigin: true,
      complete: true,
    });
    expect(getCommuteTiming(67.999, 2)).toMatchObject({
      phase: "arriving",
      stopIndex: 1,
      atOrigin: true,
      complete: true,
    });
    expect(getCommuteTiming(500, 2)).toMatchObject({
      phase: "stopped",
      stopIndex: 1,
      atOrigin: true,
      complete: true,
    });
  });

  it("includes the synchronized return home in the finite route duration", () => {
    expect(getCommuteRouteDurationSeconds(2)).toBe(68);
  });

  it("rejects an empty route", () => {
    expect(() => getCommuteTiming(0, 0)).toThrow(
      "Internet Commute requires at least one stop",
    );
  });
});
