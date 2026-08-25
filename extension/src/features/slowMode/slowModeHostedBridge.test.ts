// ABOUTME: Tests hosted Slow Mode bridge validation and fragment parsing.
// ABOUTME: Verifies that only opaque ride metadata crosses into the hosted page.

import { describe, expect, it } from "vitest";
import {
  SLOW_MODE_HOSTED_BRIDGE_SOURCE,
  SLOW_MODE_HOSTED_OUTCOME,
  SLOW_MODE_HOSTED_REQUEST,
  getHostedSlowModeRideId,
  isHostedCommuteUrl,
  isHostedSlowModeOutcome,
  isHostedSlowModeRequest,
} from "./slowModeHostedBridge";

const RIDE_ID = "8cc8e2ef-63cf-4cb6-86c7-6d4999e5641d";

describe("hosted Slow Mode bridge", () => {
  it("accepts only the hosted commute route", () => {
    expect(isHostedCommuteUrl(`https://wewere.online/commute/#ride=${RIDE_ID}`)).toBe(true);
    expect(isHostedCommuteUrl("https://wewere.online/commute/extra")).toBe(false);
    expect(isHostedCommuteUrl("https://example.com/commute/")).toBe(false);
  });

  it("reads an opaque ride id from the fragment", () => {
    expect(getHostedSlowModeRideId(`#ride=${RIDE_ID}`)).toBe(RIDE_ID);
    expect(getHostedSlowModeRideId("#ride=example.com")).toBeNull();
    expect(getHostedSlowModeRideId(`#ride=${"-".repeat(36)}`)).toBeNull();
  });

  it("validates page requests and outcomes", () => {
    expect(
      isHostedSlowModeRequest({
        source: SLOW_MODE_HOSTED_BRIDGE_SOURCE,
        type: SLOW_MODE_HOSTED_REQUEST,
        requestId: "request-1",
        rideId: RIDE_ID,
      }),
    ).toBe(true);
    expect(
      isHostedSlowModeOutcome({
        source: SLOW_MODE_HOSTED_BRIDGE_SOURCE,
        type: SLOW_MODE_HOSTED_OUTCOME,
        rideId: RIDE_ID,
        outcome: "teleported",
        navigate: true,
      }),
    ).toBe(true);
    expect(
      isHostedSlowModeOutcome({
        source: SLOW_MODE_HOSTED_BRIDGE_SOURCE,
        type: SLOW_MODE_HOSTED_OUTCOME,
        rideId: RIDE_ID,
        outcome: "riding",
        navigate: true,
      }),
    ).toBe(false);
  });
});
