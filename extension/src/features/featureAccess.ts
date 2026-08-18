// ABOUTME: Resolves extension features from server policy and local opt-in choices.
// ABOUTME: Persists the last valid entitlement snapshot so access survives transient Worker failures.

import browser from "webextension-polyfill";
import { WORKER_URL } from "@movement/config";
import {
  FEATURE_IDS,
  isFeatureId,
  resolveFeatureState,
  type FeatureAccessSnapshot,
  type FeatureId,
  type FeatureOverrides,
  type FeaturePolicy,
  type FeatureState,
} from "../flags";
import { FEATURE_CATALOG, isFeatureStage } from "../../shared/featureCatalog";

export const FEATURE_ACCESS_STORAGE_KEY = "wwoFeatureAccess";
export const FEATURE_OVERRIDES_STORAGE_KEY = "wwoFeatureOverrides";

function defaultFeatureAccess(availableToInternal: boolean): FeatureAccessSnapshot {
  return {
    features: Object.fromEntries(
      FEATURE_IDS.map((feature) => {
        const stage: FeaturePolicy["stage"] = FEATURE_CATALOG[feature].defaultStage;
        return [
          feature,
          {
            stage,
            available: availableToInternal || stage === "released",
          },
        ];
      }),
    ) as Record<FeatureId, FeaturePolicy>,
    checkedAt: 0,
  };
}

export function parseFeatureAccess(value: unknown): FeatureAccessSnapshot | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const rawFeatures = record.features;
  if (!rawFeatures || typeof rawFeatures !== "object" || Array.isArray(rawFeatures)) {
    return null;
  }
  const features = defaultFeatureAccess(false).features;
  for (const [feature, policy] of Object.entries(rawFeatures)) {
    if (!isFeatureId(feature) || !policy || typeof policy !== "object" || Array.isArray(policy)) {
      continue;
    }
    const rawPolicy = policy as Record<string, unknown>;
    if (typeof rawPolicy.stage === "string" && isFeatureStage(rawPolicy.stage) &&
        typeof rawPolicy.available === "boolean") {
      features[feature] = {
        stage: rawPolicy.stage,
        available: rawPolicy.available,
      };
    }
  }
  return {
    features,
    checkedAt: typeof record.checkedAt === "number" ? record.checkedAt : 0,
  };
}

export function parseFeatureOverrides(value: unknown): FeatureOverrides {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};

  const overrides: FeatureOverrides = {};
  for (const [feature, enabled] of Object.entries(value)) {
    if (isFeatureId(feature) && typeof enabled === "boolean") {
      overrides[feature] = enabled;
    }
  }
  return overrides;
}

export async function getFeatureAccess(): Promise<FeatureAccessSnapshot> {
  if (import.meta.env.MODE === "development") return defaultFeatureAccess(true);
  try {
    const stored = await browser.storage.local.get(FEATURE_ACCESS_STORAGE_KEY);
    return parseFeatureAccess(stored?.[FEATURE_ACCESS_STORAGE_KEY]) ?? defaultFeatureAccess(false);
  } catch {
    return defaultFeatureAccess(false);
  }
}

export async function hasExperimentAccess(): Promise<boolean> {
  const access = await getFeatureAccess();
  return FEATURE_IDS.some((feature) =>
    access.features[feature].stage !== "released" && access.features[feature].available,
  );
}

export async function hasPrivateExperimentAccess(): Promise<boolean> {
  const access = await getFeatureAccess();
  return FEATURE_IDS.some((feature) => {
    const policy = access.features[feature];
    return policy.available && (policy.stage === "internal" || policy.stage === "beta");
  });
}

export async function getFeatureOverrides(): Promise<FeatureOverrides> {
  try {
    const stored = await browser.storage.local.get(FEATURE_OVERRIDES_STORAGE_KEY);
    return parseFeatureOverrides(stored?.[FEATURE_OVERRIDES_STORAGE_KEY]);
  } catch {
    return {};
  }
}

export async function getFeatureState(feature: FeatureId): Promise<FeatureState> {
  const [access, overrides] = await Promise.all([
    getFeatureAccess(),
    getFeatureOverrides(),
  ]);
  return resolveFeatureState(feature, { access, overrides });
}

export async function isFeatureEnabled(feature: FeatureId): Promise<boolean> {
  return (await getFeatureState(feature)).enabled;
}

export async function getAllFeatureStates(): Promise<Record<FeatureId, FeatureState>> {
  const [access, overrides] = await Promise.all([
    getFeatureAccess(),
    getFeatureOverrides(),
  ]);
  return Object.fromEntries(
    FEATURE_IDS.map((feature) => [
      feature,
      resolveFeatureState(feature, { access, overrides }),
    ]),
  ) as Record<FeatureId, FeatureState>;
}

export async function setFeatureOverride(
  feature: FeatureId,
  enabled: boolean,
): Promise<void> {
  const overrides = await getFeatureOverrides();
  await browser.storage.local.set({
    [FEATURE_OVERRIDES_STORAGE_KEY]: { ...overrides, [feature]: enabled },
  });
}

export async function clearFeatureOverrides(): Promise<void> {
  await browser.storage.local.remove(FEATURE_OVERRIDES_STORAGE_KEY);
}

export async function refreshFeatureAccess(publicId: string): Promise<FeatureAccessSnapshot> {
  const response = await fetch(
    `${WORKER_URL}/feature-access/${encodeURIComponent(publicId)}`,
  );
  if (!response.ok) {
    throw new Error(`Feature access check failed with ${response.status}`);
  }

  const result = parseFeatureAccess(await response.json());
  if (!result) {
    throw new Error("Feature access check returned an invalid response");
  }

  const snapshot = { ...result, checkedAt: Date.now() };
  const overrides = await getFeatureOverrides();
  const availableOverrides = Object.fromEntries(
    Object.entries(overrides).filter(([feature]) => {
      const policy = snapshot.features[feature as FeatureId];
      return policy.available && policy.stage !== "released";
    }),
  ) as FeatureOverrides;
  await browser.storage.local.set({
    [FEATURE_ACCESS_STORAGE_KEY]: snapshot,
    [FEATURE_OVERRIDES_STORAGE_KEY]: availableOverrides,
  });
  return snapshot;
}
