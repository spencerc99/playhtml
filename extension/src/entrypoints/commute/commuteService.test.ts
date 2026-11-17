// ABOUTME: Verifies the Internet Commute's server clock calibration.
// ABOUTME: Covers the request-midpoint offset and rejection of invalid samples.

import { describe, expect, it } from "vitest";
import { estimateServerTimeOffset } from "./commuteService";

describe("Internet Commute server clock", () => {
  it("estimates server time from the request midpoint", () => {
    expect(estimateServerTimeOffset(10_050, 9_900, 10_100)).toBe(50);
  });

  it("rejects invalid server timing samples", () => {
    expect(() => estimateServerTimeOffset(10_000, 10_100, 10_000)).toThrow(
      "valid server timing sample",
    );
  });
});
