// ABOUTME: Tests parsing of locally persisted extension feature overrides.
// ABOUTME: Ensures stale and malformed feature ids cannot enter runtime access state.

import { describe, expect, it } from "vitest";
import { parseFeatureOverrides } from "../features/featureAccess";

describe("parseFeatureOverrides", () => {
  it("keeps only known features with boolean values", () => {
    expect(
      parseFeatureOverrides({
        COMMUTE: true,
        INVENTORY: false,
        UNKNOWN: true,
        SCRAPS: "yes",
      }),
    ).toEqual({ COMMUTE: true, INVENTORY: false });
  });

  it("returns no overrides for invalid storage values", () => {
    expect(parseFeatureOverrides(null)).toEqual({});
    expect(parseFeatureOverrides([])).toEqual({});
    expect(parseFeatureOverrides("COMMUTE")).toEqual({});
  });
});
