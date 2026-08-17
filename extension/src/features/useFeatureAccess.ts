// ABOUTME: React hooks for feature eligibility and per-feature runtime state.
// ABOUTME: Keeps extension surfaces synchronized when internal settings change in local storage.

import { useCallback, useEffect, useState } from "react";
import browser from "webextension-polyfill";
import {
  FEATURE_CATALOG,
  resolveFeatureState,
  type FeatureId,
  type FeatureState,
} from "../flags";
import {
  FEATURE_OVERRIDES_STORAGE_KEY,
  INTERNAL_ACCESS_STORAGE_KEY,
  getFeatureState,
  getInternalAccess,
} from "./featureAccess";

export function useFeatureState(feature: FeatureId): FeatureState {
  const [state, setState] = useState<FeatureState>(() =>
    resolveFeatureState(feature, { internalAccess: false }),
  );

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
        (changes[INTERNAL_ACCESS_STORAGE_KEY] ||
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

export function useInternalAccess(): boolean {
  const [enabled, setEnabled] = useState(import.meta.env.MODE === "development");

  const reload = useCallback(() => {
    getInternalAccess().then(setEnabled).catch(() => {});
  }, []);

  useEffect(() => {
    reload();
    const onChanged = (
      changes: Record<string, browser.Storage.StorageChange>,
      areaName: string,
    ) => {
      if (areaName === "local" && changes[INTERNAL_ACCESS_STORAGE_KEY]) {
        reload();
      }
    };
    browser.storage.onChanged.addListener(onChanged);
    return () => browser.storage.onChanged.removeListener(onChanged);
  }, [reload]);

  return enabled;
}

export function getInitialFeatureState(feature: FeatureId): FeatureState {
  return FEATURE_CATALOG[feature].released
    ? { enabled: true, source: "released" }
    : { enabled: false, source: "unavailable" };
}
