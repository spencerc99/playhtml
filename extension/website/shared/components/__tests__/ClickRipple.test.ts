// ABOUTME: Tests click and hold ripple timing independently from React animation scheduling.
// ABOUTME: Covers bounded hold scaling and persistent residue after expansion.

import { describe, expect, it } from "vitest";
import { getRippleLifecycle } from "../ClickRipple";
import { CLICK_DEFAULTS } from "../clickDefaults";

describe("getRippleLifecycle", () => {
  it("caps very long holds at three times the normal size and duration", () => {
    const lifecycle = getRippleLifecycle(
      {
        id: "long-hold",
        x: 0,
        y: 0,
        color: "#000",
        radiusFactor: 0.5,
        durationFactor: 0.5,
        startTime: 1000,
        trailIndex: 0,
        holdDuration: 20 * 60 * 1000,
      },
      CLICK_DEFAULTS,
      1000,
    );

    expect(lifecycle.holdMultiplier).toBe(3);
    expect(lifecycle.expansionDuration).toBe(
      CLICK_DEFAULTS.clickExpansionDuration * 3,
    );
  });

  it("keeps a completed ripple visible as trail residue", () => {
    const effect = {
      id: "click",
      x: 0,
      y: 0,
      color: "#000",
      radiusFactor: 0.5,
      durationFactor: 0,
      startTime: 1000,
      trailIndex: 0,
    };
    const completionTime =
      effect.startTime + CLICK_DEFAULTS.clickMinDuration + 10_000;

    expect(
      getRippleLifecycle(
        effect,
        CLICK_DEFAULTS,
        completionTime,
      ),
    ).toMatchObject({
      opacity: CLICK_DEFAULTS.clickOpacity,
      complete: true,
    });
  });
});
