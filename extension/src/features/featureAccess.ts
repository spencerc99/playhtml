// ABOUTME: Resolves extension feature access from release state, server eligibility, and local overrides.
// ABOUTME: Persists a resilient eligibility cache so beta access survives transient Worker failures.

import browser from "webextension-polyfill";
import { WORKER_URL } from "@movement/config";
import {
  FEATURE_IDS,
  isFeatureId,
  resolveFeatureState,
  type FeatureId,
  type FeatureOverrides,
  type FeatureState,
} from "../flags";

export const INTERNAL_ACCESS_STORAGE_KEY = "wwoInternalAccess";
export const FEATURE_OVERRIDES_STORAGE_KEY = "wwoFeatureOverrides";

export type InternalAccessCache = {
  enabled: boolean;
  checkedAt: number;
};

function developmentBuildHasAccess(): boolean {
  return import.meta.env.MODE === "development";
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

export async function getInternalAccess(): Promise<boolean> {
  if (developmentBuildHasAccess()) return true;
  const stored = await browser.storage.local.get(INTERNAL_ACCESS_STORAGE_KEY);
  const cache = stored[INTERNAL_ACCESS_STORAGE_KEY] as
    | InternalAccessCache
    | undefined;
  return cache?.enabled === true;
}

export async function getFeatureOverrides(): Promise<FeatureOverrides> {
  const stored = await browser.storage.local.get(FEATURE_OVERRIDES_STORAGE_KEY);
  return parseFeatureOverrides(stored[FEATURE_OVERRIDES_STORAGE_KEY]);
}

export async function getFeatureState(feature: FeatureId): Promise<FeatureState> {
  const [internalAccess, overrides] = await Promise.all([
    getInternalAccess(),
    getFeatureOverrides(),
  ]);
  return resolveFeatureState(feature, { internalAccess, overrides });
}

export async function isFeatureEnabled(feature: FeatureId): Promise<boolean> {
  return (await getFeatureState(feature)).enabled;
}

export async function getAllFeatureStates(): Promise<Record<FeatureId, FeatureState>> {
  const [internalAccess, overrides] = await Promise.all([
    getInternalAccess(),
    getFeatureOverrides(),
  ]);
  return Object.fromEntries(
    FEATURE_IDS.map((feature) => [
      feature,
      resolveFeatureState(feature, { internalAccess, overrides }),
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

export async function refreshInternalAccess(publicId: string): Promise<boolean> {
  const response = await fetch(
    `${WORKER_URL}/internal-access/${encodeURIComponent(publicId)}`,
  );
  if (!response.ok) {
    throw new Error(`Internal access check failed with ${response.status}`);
  }

  const result = (await response.json()) as { enabled?: unknown };
  if (typeof result.enabled !== "boolean") {
    throw new Error("Internal access check returned an invalid response");
  }

  await browser.storage.local.set({
    [INTERNAL_ACCESS_STORAGE_KEY]: {
      enabled: result.enabled,
      checkedAt: Date.now(),
    } satisfies InternalAccessCache,
  });
  return result.enabled;
}
