// ABOUTME: Initializes inventory + social experiments that run on every page.
// ABOUTME: Inventory is built first so deps.inventory exists when each experiment's init registers items.

import browser from "webextension-polyfill";
import { FLAGS } from "../flags";
import { SOCIAL_EXPERIMENTS } from "./social/registry";
import type { GlobalFeatureDeps } from "./social/types";
import { InventoryManager } from "./inventory/InventoryManager";

// TEMP STUB — replaced in the "satchel surface" task (Task 9) with the real import:
//   import { initInventorySurface } from "./inventory";
const initInventorySurface = (_deps: GlobalFeatureDeps): (() => void) => () => {};

export type { GlobalFeatureDeps } from "./social/types";

/** Deps the caller supplies — everything in GlobalFeatureDeps except `inventory`, which we build here. */
type CallerDeps = Omit<GlobalFeatureDeps, "inventory">;

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

function isExperimentActive(
  exp: { flag: keyof typeof FLAGS },
  devEnabled: boolean,
): boolean {
  // Run if shipped-on for everyone, or if this dev has internal features on.
  return Boolean(FLAGS[exp.flag]) || devEnabled;
}

/**
 * Whether any social experiment would run on this page. The content script
 * calls this before deciding to spin up a headless playhtml instance — on
 * pages where no experiment is active we open no connection at all.
 */
export async function anyGlobalFeatureActive(): Promise<boolean> {
  const devEnabled = await internalDevFeaturesEnabled();
  return SOCIAL_EXPERIMENTS.some((exp) => isExperimentActive(exp, devEnabled));
}

export async function initGlobalFeatures(
  caller: CallerDeps,
): Promise<() => void> {
  const cleanups: (() => void)[] = [];
  const devEnabled = await internalDevFeaturesEnabled();

  const manager = new InventoryManager();
  try {
    await manager.load();
  } catch (err) {
    // A storage read failure must not take down the social experiments; continue with an empty held store.
    console.error("[we-were-online] inventory load failed, continuing with empty held store:", err);
  }
  const deps: GlobalFeatureDeps = { ...caller, inventory: manager.api };

  for (const exp of SOCIAL_EXPERIMENTS) {
    if (!isExperimentActive(exp, devEnabled)) continue;
    try {
      const cleanup = await exp.init(deps);
      cleanups.push(cleanup);
    } catch (err) {
      console.error(`[we-were-online] social experiment "${exp.id}" failed:`, err);
    }
  }

  // Mount the satchel surface only if inventory is enabled and at least one item registered.
  if (FLAGS.INVENTORY && manager.api.list().length > 0) {
    cleanups.push(initInventorySurface(deps));
  }

  return () => {
    for (const c of cleanups) {
      try {
        c();
      } catch (err) {
        console.error("[we-were-online] social experiment cleanup failed:", err);
      }
    }
  };
}
