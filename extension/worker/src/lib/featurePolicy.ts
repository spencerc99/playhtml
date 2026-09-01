// ABOUTME: Resolves the effective feature policy from the code catalog and stored rollout controls.
// ABOUTME: Keeps catalog features visible when production has no matching policy row.

import {
  FEATURE_CATALOG,
  FEATURE_IDS,
  isFeatureStage,
  type FeatureAccessSnapshot,
  type FeatureId,
  type FeatureStage,
} from '../../../shared/featureCatalog';

export function resolveFeatureStage(
  featureId: FeatureId,
  storedStages: ReadonlyMap<string, string>,
): FeatureStage {
  const storedStage = storedStages.get(featureId);
  return storedStage && isFeatureStage(storedStage)
    ? storedStage
    : FEATURE_CATALOG[featureId].defaultStage;
}

export function resolveFeaturePolicies(options: {
  storedStages: ReadonlyMap<string, string>;
  grantsAllUnreleased: boolean;
  grantedFeatureIds: ReadonlySet<string>;
}): FeatureAccessSnapshot['features'] {
  return Object.fromEntries(
    FEATURE_IDS.map((featureId) => {
      const stage = resolveFeatureStage(featureId, options.storedStages);
      return [
        featureId,
        {
          stage,
          available:
            stage === 'released' ||
            options.grantsAllUnreleased ||
            options.grantedFeatureIds.has(featureId),
        },
      ];
    }),
  ) as FeatureAccessSnapshot['features'];
}
