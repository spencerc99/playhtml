// ABOUTME: Verifies the shared portrait timestamp includes its UTC date and time.
// ABOUTME: Keeps live and historical wordmark clocks formatted consistently.

import { describe, expect, it } from "vitest";
import { formatWordmarkTimestamp } from "../WordmarkClock";

describe("formatWordmarkTimestamp", () => {
  it("formats the full UTC portrait timestamp", () => {
    expect(formatWordmarkTimestamp(new Date("2026-08-15T19:55:08Z"))).toBe(
      "Saturday, August 15 · 19:55:08 UTC",
    );
  });
});
