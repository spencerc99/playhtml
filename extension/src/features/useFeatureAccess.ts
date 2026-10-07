// ABOUTME: React hooks for experiment availability and effective runtime state.
// ABOUTME: Keeps extension surfaces synchronized when server access or local choices change.

import { useCallback, useEffect, useState } from "react";
import browser from "webextension-polyfill";
import { type FeatureId, type FeatureState } from "../flags";
import {
  FEATURE_ACCESS_STORAGE_KEY,
  FEATURE_OVERRIDES_STORAGE_KEY,
  getFeatureState,
  hasExperimentAccess,
  hasPrivateExperimentAccess,
} from "./featureAccess";

const UNSETTLED_FEATURE_STATE: FeatureState = {
  enabled: false,
  available: false,
  stage: "internal",
  source: "unavailable",
};

export function useFeatureState(feature: FeatureId): FeatureState {
  return useSettledFeatureState(feature) ?? UNSETTLED_FEATURE_STATE;
}

/**
 * The feature's state, or null until it has been read once, for a surface
 * that must tell "not yet known" apart from "unavailable".
 */
export function useSettledFeatureState(feature: FeatureId): FeatureState | null {
  const [state, setState] = useState<FeatureState | null>(null);

  const reload = useCallback(() => {
    getFeatureState(feature)
      .then(setState)
      .catch((error: unknown) => {
        // A state that cannot be read is treated as unavailable, and said so.
        console.warn(`Could not read feature state for ${feature}:`, error);
        setState(UNSETTLED_FEATURE_STATE);
      });
  }, [feature]);

  useEffect(() => {
    reload();
    const onChanged = (
      changes: Record<string, browser.Storage.StorageChange>,
      areaName: string,
    ) => {
      if (
        areaName === "local" &&
        (changes[FEATURE_ACCESS_STORAGE_KEY] ||
          changes[FEATURE_OVERRIDES_STORAGE_KEY])
      ) {
        reload();
      }
    };
    browser.storage.onChanged.addListener(onChanged);
    return () => browser.storage.onChanged.removeListener(onChanged);
  }, [reload]);

  return state;
}

function useExperimentAccessCheck(checkAccess: () => Promise<boolean>): boolean {
  const [enabled, setEnabled] = useState(import.meta.env.MODE === "development");

  const reload = useCallback(() => {
    checkAccess().then(setEnabled).catch(() => {});
  }, [checkAccess]);

  useEffect(() => {
    reload();
    const onChanged = (
      changes: Record<string, browser.Storage.StorageChange>,
      areaName: string,
    ) => {
      if (areaName === "local" && changes[FEATURE_ACCESS_STORAGE_KEY]) {
        reload();
      }
    };
    browser.storage.onChanged.addListener(onChanged);
    return () => browser.storage.onChanged.removeListener(onChanged);
  }, [reload]);

  return enabled;
}

export function useExperimentAccess(): boolean {
  return useExperimentAccessCheck(hasExperimentAccess);
}

export function usePrivateExperimentAccess(): boolean {
  return useExperimentAccessCheck(hasPrivateExperimentAccess);
}
