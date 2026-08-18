// ABOUTME: Tests the extension feature catalog and access resolution rules.
// ABOUTME: Verifies released, internal, and per-feature override precedence.

import { describe, expect, it } from "vitest";
import {
  FEATURE_IDS,
  isFeatureId,
  resolveFeatureState,
} from "../flags";

describe("feature flags", () => {
  it("keeps catalog ids discoverable and rejects unknown ids", () => {
    expect(FEATURE_IDS).toContain("COMMUTE");
    expect(isFeatureId("COMMUTE")).toBe(true);
    expect(isFeatureId("NOT_A_FEATURE")).toBe(false);
  });

  it("only enables released features for public users", () => {
    expect(
      resolveFeatureState("INVENTORY", { internalAccess: false }),
    ).toEqual({ enabled: true, source: "released" });
    expect(
      resolveFeatureState("COMMUTE", { internalAccess: false }),
    ).toEqual({ enabled: false, source: "unavailable" });
  });

  it("enables unfinished features for people with internal access", () => {
    expect(
      resolveFeatureState("COMMUTE", { internalAccess: true }),
    ).toEqual({ enabled: true, source: "internal-access" });
  });

  it("lets internal users override released and unfinished features", () => {
    expect(
      resolveFeatureState("INVENTORY", {
        internalAccess: true,
        overrides: { INVENTORY: false },
      }),
    ).toEqual({ enabled: false, source: "override" });
    expect(
      resolveFeatureState("COMMUTE", {
        internalAccess: true,
        overrides: { COMMUTE: false },
      }),
    ).toEqual({ enabled: false, source: "override" });
  });

  it("does not let public users spoof feature overrides", () => {
    expect(
      resolveFeatureState("COMMUTE", {
        internalAccess: false,
        overrides: { COMMUTE: true },
      }),
    ).toEqual({ enabled: false, source: "unavailable" });
  });
});
