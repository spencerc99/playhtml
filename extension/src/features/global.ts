// ABOUTME: Initializes social experiments that run on every page (bottles, quarantine tape, …).
// ABOUTME: Each experiment runs if its FLAG is on for everyone, OR the user has internal dev features enabled.

import browser from "webextension-polyfill";
import { FLAGS } from "../flags";
import { SOCIAL_EXPERIMENTS } from "./social/registry";
import type { GlobalFeatureDeps } from "./social/types";

export type { GlobalFeatureDeps } from "./social/types";

/**
 * Dev override: when a developer has toggled internal dev features on
 * (Cmd+Shift+. in the popup → browser.storage.local.internalDevFeaturesEnabled),
 * ALL social experiments run regardless of their committed flags. This lets us
 * land experiments on main flag-off (inert for users) while still testing them.
 */
async function internalDevFeaturesEnabled(): Promise<boolean> {
  try {
    const r = await browser.storage.local.get("internalDevFeaturesEnabled");
    return Boolean(r.internalDevFeaturesEnabled);
  } catch {
    return false;
  }
}

export async function initGlobalFeatures(
  deps: GlobalFeatureDeps,
): Promise<() => void> {
  const cleanups: (() => void)[] = [];
  const devEnabled = await internalDevFeaturesEnabled();

  for (const exp of SOCIAL_EXPERIMENTS) {
    // Run if shipped-on for everyone, or if this dev has internal features on.
    if (!FLAGS[exp.flag] && !devEnabled) continue;
    try {
      const cleanup = await exp.init(deps);
      cleanups.push(cleanup);
    } catch (err) {
      console.error(`[we-were-online] social experiment "${exp.id}" failed:`, err);
    }
  }

  return () => {
    for (const c of cleanups) c();
  };
}
