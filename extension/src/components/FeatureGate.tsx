// ABOUTME: Renders extension UI only when its catalog feature is effectively enabled.
// ABOUTME: Reacts to experiment eligibility and local override changes without reopening the surface.

import type { ReactNode } from "react";
import type { FeatureId } from "../flags";
import { useFeatureState } from "../features/useFeatureAccess";

export function FeatureGate({
  feature,
  children,
}: {
  feature: FeatureId;
  children: ReactNode;
}) {
  return useFeatureState(feature).enabled ? children : null;
}
