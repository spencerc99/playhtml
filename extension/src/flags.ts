// ABOUTME: Resolves effective extension feature states from server access and local choices.
// ABOUTME: Re-exports the shared catalog for existing extension feature consumers.

import {
  FEATURE_CATALOG,
  FEATURE_IDS,
  isFeatureId,
  type FeatureAccessSnapshot,
  type FeatureId,
} from "../shared/featureCatalog";

export {
  FEATURE_CATALOG,
  FEATURE_IDS,
  isFeatureId,
  type FeatureAccessSnapshot,
  type FeatureId,
  type FeaturePolicy,
  type FeatureStage,
} from "../shared/featureCatalog";

export type FeatureOverrides = Partial<Record<FeatureId, boolean>>;

export const FLAGS = Object.fromEntries(
  FEATURE_IDS.map((feature) => [
    feature,
    FEATURE_CATALOG[feature].defaultStage === "released",
  ]),
) as Record<FeatureId, boolean>;

export type FeatureState = {
  enabled: boolean;
  available: boolean;
  stage: FeatureAccessSnapshot["features"][FeatureId]["stage"];
  source: "released" | "choice" | "available" | "unavailable";
};

export function resolveFeatureState(
  feature: FeatureId,
  options: {
    access: FeatureAccessSnapshot;
    overrides?: FeatureOverrides;
  },
): FeatureState {
  const policy = options.access.features[feature];
  if (!policy.available) {
    return { enabled: false, available: false, stage: policy.stage, source: "unavailable" };
  }

  if (policy.stage === "released") {
    return { enabled: true, available: true, stage: policy.stage, source: "released" };
  }

  const override = options.overrides?.[feature];
  if (override !== undefined) {
    return { enabled: override, available: true, stage: policy.stage, source: "choice" };
  }

  return { enabled: false, available: true, stage: policy.stage, source: "available" };
}
