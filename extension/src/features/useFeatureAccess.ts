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

export function useFeatureState(feature: FeatureId): FeatureState {
  const [state, setState] = useState<FeatureState>({
    enabled: false,
    available: false,
    stage: "internal",
    source: "unavailable",
  });

  const reload = useCallback(() => {
    getFeatureState(feature).then(setState).catch(() => {});
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
