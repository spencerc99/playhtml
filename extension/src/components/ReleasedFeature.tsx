// ABOUTME: Defines the committed release boundary for user-facing extension features.
// ABOUTME: Prevents internal development settings from exposing unfinished navigation.

import type { ReactNode } from "react";
import { FLAGS } from "../flags";

export type FeatureFlag = keyof typeof FLAGS;

export function isFeatureReleased(feature: FeatureFlag): boolean {
  return FLAGS[feature];
}

export function ReleasedFeature({
  feature,
  children,
}: {
  feature: FeatureFlag;
  children: ReactNode;
}) {
  return isFeatureReleased(feature) ? children : null;
}
