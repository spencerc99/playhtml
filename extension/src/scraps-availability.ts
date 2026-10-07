// ABOUTME: Resolves whether the internet-scraps surfaces are reachable for this user.
// ABOUTME: Uses the same effective SCRAPS state as collection and popup surfaces.

import { isFeatureEnabled } from "./features/featureAccess";

export async function scrapsAvailable(): Promise<boolean> {
  return isFeatureEnabled("SCRAPS");
}
