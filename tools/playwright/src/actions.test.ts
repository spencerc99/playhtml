// ABOUTME: Verifies pure timing helpers for artificial-user browser actions.
// ABOUTME: Keeps actor rhythm scaling bounded before Playwright actions use it.

import { describe, expect, test } from "bun:test";
import { scaleDuration } from "./actions";

describe("scaleDuration", () => {
  test("scales action duration by persona tempo", () => {
    expect(scaleDuration(1000, 1.25)).toBe(1250);
    expect(scaleDuration(1000, 0.8)).toBe(800);
  });

  test("never returns a sub-frame duration", () => {
    expect(scaleDuration(1, 0.1)).toBe(25);
  });
});
