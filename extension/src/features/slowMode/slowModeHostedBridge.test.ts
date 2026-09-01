// ABOUTME: Tests hosted Slow Mode bridge validation and fragment parsing.
// ABOUTME: Verifies that only opaque ride metadata crosses into the hosted page.

import { describe, expect, it, vi } from "vitest";
import {
  SLOW_MODE_HOSTED_BRIDGE_SOURCE,
  SLOW_MODE_HOSTED_OUTCOME,
  SLOW_MODE_HOSTED_REQUEST,
  SLOW_MODE_HOSTED_RESPONSE,
  getHostedSlowModeRideId,
  isHostedCommuteUrl,
  isHostedSlowModeOutcome,
  isHostedSlowModeRequest,
  requestHostedSlowModeRide,
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

  it("keeps requesting while the extension bridge starts", async () => {
    vi.useFakeTimers();
    let requestCount = 0;
    const ride = {
      rideId: RIDE_ID,
      destinationDomain: "example.com",
      stopVisibility: "domain" as const,
    };
    const postMessage = vi
      .spyOn(window, "postMessage")
      .mockImplementation((message: unknown) => {
        if (!isHostedSlowModeRequest(message)) return;
        requestCount += 1;
        if (requestCount !== 2) return;
        queueMicrotask(() => {
          window.dispatchEvent(
            new MessageEvent("message", {
              data: {
                source: SLOW_MODE_HOSTED_BRIDGE_SOURCE,
                type: SLOW_MODE_HOSTED_RESPONSE,
                requestId: message.requestId,
                ride,
              },
              source: window,
            }),
          );
        });
      });

    try {
      const result = requestHostedSlowModeRide(RIDE_ID);
      await vi.advanceTimersByTimeAsync(500);

      expect(requestCount).toBe(2);
      await expect(result).resolves.toEqual(ride);
    } finally {
      postMessage.mockRestore();
      vi.useRealTimers();
    }
  });
});
