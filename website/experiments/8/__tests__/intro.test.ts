// ABOUTME: Verifies the Experiment 8 opening scroll animation.
// ABOUTME: Covers its starting point, eased midpoint, and destination.
import { describe, expect, it } from "vitest";
import { getIntroScrollY } from "../intro";

describe("experiment 8 introduction", () => {
  it("starts at the top of the paper", () => {
    expect(
      getIntroScrollY({ destinationY: 800, elapsedMs: 0, durationMs: 2000 }),
    ).toBe(0);
  });

  it("passes through the middle of the paper", () => {
    expect(
      getIntroScrollY({ destinationY: 800, elapsedMs: 1000, durationMs: 2000 }),
    ).toBe(400);
  });

  it("stops at the end of the paper", () => {
    expect(
      getIntroScrollY({ destinationY: 800, elapsedMs: 3000, durationMs: 2000 }),
    ).toBe(800);
  });
});
