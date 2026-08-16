// ABOUTME: Tests click and hold ripple timing independently from React animation scheduling.
// ABOUTME: Covers bounded hold scaling and the visible fade at ripple completion.

import { describe, expect, it } from "vitest";
import {
  RIPPLE_FADE_MS,
  getRippleLifecycle,
} from "../ClickRipple";
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

  it("fades a completed ripple to transparent before removing it", () => {
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
    const completionTime = effect.startTime + CLICK_DEFAULTS.clickMinDuration;

    expect(
      getRippleLifecycle(effect, CLICK_DEFAULTS, completionTime).opacity,
    ).toBe(CLICK_DEFAULTS.clickOpacity);
    expect(
      getRippleLifecycle(
        effect,
        CLICK_DEFAULTS,
        completionTime + RIPPLE_FADE_MS / 2,
      ).opacity,
    ).toBeCloseTo(CLICK_DEFAULTS.clickOpacity / 2);
    expect(
      getRippleLifecycle(
        effect,
        CLICK_DEFAULTS,
        completionTime + RIPPLE_FADE_MS,
      ),
    ).toMatchObject({ opacity: 0, complete: true });
  });
});
