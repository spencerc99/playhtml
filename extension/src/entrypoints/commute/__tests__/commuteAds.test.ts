// ABOUTME: Verifies deterministic Internet Commute poster rotation by domain.
// ABOUTME: Covers the extension-dependent transit-pass eligibility rule.

import { describe, expect, it } from "vitest";
import {
  COMMUTE_ADS,
  getCommuteAd,
  getEligibleCommuteAds,
} from "../commuteAds";

describe("commute ads", () => {
  it("selects the same ad for the same domain and eligibility set", () => {
    expect(getCommuteAd("example.com", false)).toBe(
      getCommuteAd("example.com", false),
    );
    expect(getCommuteAd("example.com", true)).toBe(
      getCommuteAd("example.com", true),
    );
  });

  it("only includes the transit pass when the extension is missing", () => {
    expect(getEligibleCommuteAds(false)).toEqual(COMMUTE_ADS);
    expect(getEligibleCommuteAds(false).map((ad) => ad.id)).not.toContain(
      "transit-pass",
    );
    expect(getEligibleCommuteAds(true).map((ad) => ad.id)).toContain(
      "transit-pass",
    );
    expect(getCommuteAd("ad-0.test", true).id).toBe("transit-pass");
    expect(getCommuteAd("ad-0.test", false).id).not.toBe("transit-pass");
  });
});
