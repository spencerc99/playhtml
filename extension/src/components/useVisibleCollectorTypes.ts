// ABOUTME: Resolves which collector types the settings and setup UIs should show.
// ABOUTME: Keeps flagged collectors out of sight until they are released or dev-enabled.

import { useEffect, useState } from "react";
import browser from "webextension-polyfill";
import type { CollectionEventType } from "@playhtml/extension-types";
import { getValidEventTypes } from "@playhtml/extension-types";
import { isFeatureReleased, type FeatureFlag } from "./ReleasedFeature";

const DEV_FEATURES_KEY = "internalDevFeaturesEnabled";

/**
 * Collector types that only run behind a feature flag. The content script gates
 * their registration the same way, so showing them elsewhere would offer a
 * control over a collector that never starts.
 */
const FLAGGED_COLLECTOR_TYPES: Partial<Record<CollectionEventType, FeatureFlag>> =
  {
    element: "SCRAPS",
  };

export function visibleCollectorTypes(
  devFeaturesEnabled: boolean,
): CollectionEventType[] {
  return getValidEventTypes().filter((type) => {
    const flag = FLAGGED_COLLECTOR_TYPES[type];
    if (!flag) return true;
    return isFeatureReleased(flag) || devFeaturesEnabled;
  });
}

export function useVisibleCollectorTypes(): CollectionEventType[] {
  const [devFeaturesEnabled, setDevFeaturesEnabled] = useState(false);

  useEffect(() => {
    let active = true;
    browser.storage.local
      .get([DEV_FEATURES_KEY])
      .then((result) => {
        if (active) setDevFeaturesEnabled(Boolean(result[DEV_FEATURES_KEY]));
      })
      .catch(() => {
        // Storage unavailable — stay on the released set.
      });
    return () => {
      active = false;
    };
  }, []);

  return visibleCollectorTypes(devFeaturesEnabled);
}
