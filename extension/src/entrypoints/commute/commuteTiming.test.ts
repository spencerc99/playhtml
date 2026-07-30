// ABOUTME: Verifies the train phase sequence and stop progression.
// ABOUTME: Covers the origin platform, travel, arrival, and destination dwell.

import { describe, expect, it } from "vitest";
import { getCommuteTiming } from "./commuteTiming";

describe("getCommuteTiming", () => {
  it("starts at the origin with open doors", () => {
    expect(getCommuteTiming(0, 5)).toEqual({
      phase: "stopped",
      secondsLeft: 12,
      stopIndex: 0,
      atOrigin: true,
    });
  });

  it("moves through travel, arrival, and the destination platform", () => {
    expect(getCommuteTiming(12, 5).phase).toBe("riding");
    expect(getCommuteTiming(32, 5)).toEqual({
      phase: "arriving",
      secondsLeft: 4,
      stopIndex: 0,
      atOrigin: false,
    });
    expect(getCommuteTiming(36, 5)).toEqual({
      phase: "stopped",
      secondsLeft: 12,
      stopIndex: 0,
      atOrigin: false,
    });
  });

  it("advances to the next route stop after the platform dwell", () => {
    expect(getCommuteTiming(48, 5)).toEqual({
      phase: "riding",
      secondsLeft: 20,
      stopIndex: 1,
      atOrigin: false,
    });
  });

  it("rejects an empty route", () => {
    expect(() => getCommuteTiming(0, 0)).toThrow(
      "Internet Commute requires at least one stop",
    );
  });
});
