import { describe, expect, it } from "vitest";
import { swipeDirection } from "../swipe";

describe("swipeDirection", () => {
  it("reads a quick vertical flick as up or down", () => {
    expect(swipeDirection(4, -80, 200)).toBe("up");
    expect(swipeDirection(-6, 90, 250)).toBe("down");
  });

  it("reads a quick horizontal flick as left or right", () => {
    expect(swipeDirection(-70, 5, 180)).toBe("left");
    expect(swipeDirection(60, -8, 300)).toBe("right");
  });

  it("ignores a tap or a short nudge", () => {
    expect(swipeDirection(2, 3, 90)).toBeNull();
    expect(swipeDirection(0, 30, 120)).toBeNull();
  });

  it("ignores a slow drag", () => {
    expect(swipeDirection(0, 200, 1200)).toBeNull();
  });

  it("ignores a diagonal that commits to neither axis", () => {
    expect(swipeDirection(60, 60, 200)).toBeNull();
  });
});
