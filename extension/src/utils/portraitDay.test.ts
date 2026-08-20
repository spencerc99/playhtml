// ABOUTME: Verifies walking-record portrait links preserve valid local calendar days.
// ABOUTME: Rejects malformed or impossible day filters before portrait data loads.

import { describe, expect, it } from "vitest";
import { portraitDayFromSearch, portraitDayPath } from "./portraitDay";

describe("portrait day links", () => {
  it("round-trips a valid local day", () => {
    const path = portraitDayPath("2026-08-05");

    expect(path).toBe("portrait.html?day=2026-08-05");
    expect(portraitDayFromSearch(path.slice(path.indexOf("?")))).toBe(
      "2026-08-05",
    );
  });

  it("rejects malformed and impossible days", () => {
    expect(portraitDayFromSearch("?day=2026-02-30")).toBeNull();
    expect(portraitDayFromSearch("?day=august-5")).toBeNull();
    expect(portraitDayFromSearch("")).toBeNull();
  });
});
