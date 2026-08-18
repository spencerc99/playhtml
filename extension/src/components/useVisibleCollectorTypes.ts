// ABOUTME: Resolves which collector types the settings and setup UIs should show.
// ABOUTME: Keeps flagged collectors out of sight until effective feature access enables them.

import type { CollectionEventType } from "@playhtml/extension-types";
import { getValidEventTypes } from "@playhtml/extension-types";
import type { FeatureId } from "../flags";
import { useFeatureState } from "../features/useFeatureAccess";

/**
 * Collector types that only run behind a feature flag. The content script gates
 * their registration the same way, so showing them elsewhere would offer a
 * control over a collector that never starts.
 */
const FLAGGED_COLLECTOR_TYPES: Partial<Record<CollectionEventType, FeatureId>> =
  {
    element: "SCRAPS",
  };

export function visibleCollectorTypes(
  scrapsEnabled: boolean,
): CollectionEventType[] {
  return getValidEventTypes().filter((type) => {
    const flag = FLAGGED_COLLECTOR_TYPES[type];
    if (!flag) return true;
    return flag === "SCRAPS" && scrapsEnabled;
  });
}

export function useVisibleCollectorTypes(): CollectionEventType[] {
  const scrapsEnabled = useFeatureState("SCRAPS").enabled;
  return visibleCollectorTypes(scrapsEnabled);
}
