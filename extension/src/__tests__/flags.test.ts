// ABOUTME: Tests the extension feature catalog and access resolution rules.
// ABOUTME: Verifies release, entitlement, and local opt-in precedence.

import { describe, expect, it } from "vitest";
import {
  FEATURE_CATALOG,
  FEATURE_IDS,
  isFeatureId,
  resolveFeatureState,
  type FeatureAccessSnapshot,
  type FeatureId,
} from "../flags";

function access(availableFeatures: FeatureId[] = []): FeatureAccessSnapshot {
  return {
    features: Object.fromEntries(FEATURE_IDS.map((feature) => {
      const stage: FeatureAccessSnapshot["features"][FeatureId]["stage"] =
        FEATURE_CATALOG[feature].defaultStage;
      return [feature, {
        stage,
        available: stage === "released" || availableFeatures.includes(feature),
      }];
    })) as FeatureAccessSnapshot["features"],
    checkedAt: 0,
  };
}

describe("feature flags", () => {
  it("keeps catalog ids discoverable and rejects unknown ids", () => {
    expect(FEATURE_IDS).toContain("COMMUTE");
    expect(isFeatureId("COMMUTE")).toBe(true);
    expect(isFeatureId("NOT_A_FEATURE")).toBe(false);
  });

  it("only enables released features for public users", () => {
    expect(resolveFeatureState("INVENTORY", { access: access() })).toEqual({
      enabled: true,
      available: true,
      stage: "released",
      source: "released",
    });
    expect(resolveFeatureState("COMMUTE", { access: access() })).toEqual({
      enabled: false,
      available: false,
      stage: "beta",
      source: "unavailable",
    });
  });

  it("keeps newly granted experiments off until the tester opts in", () => {
    expect(resolveFeatureState("COMMUTE", { access: access(["COMMUTE"]) })).toEqual({
      enabled: false,
      available: true,
      stage: "beta",
      source: "available",
    });
  });

  it("applies local choices only to available experiments", () => {
    expect(resolveFeatureState("COMMUTE", {
      access: access(["COMMUTE"]),
      overrides: { COMMUTE: true },
    })).toEqual({
      enabled: true,
      available: true,
      stage: "beta",
      source: "choice",
    });
    expect(resolveFeatureState("BOTTLES", {
      access: access(),
      overrides: { BOTTLES: true },
    })).toEqual({
      enabled: false,
      available: false,
      stage: "internal",
      source: "unavailable",
    });
  });
});
