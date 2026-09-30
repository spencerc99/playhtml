// ABOUTME: Initializes inventory + social experiments that run on every page.
// ABOUTME: Inventory is built first so deps.inventory exists when each experiment's init registers items.

import { getAllFeatureStates } from "./featureAccess";
import { SOCIAL_EXPERIMENTS } from "./social/registry";
import type { GlobalFeatureDeps } from "./social/types";
import { InventoryManager } from "./inventory/InventoryManager";
import { initInventorySurface } from "./inventory";

export type { GlobalFeatureDeps } from "./social/types";

/** Deps the caller supplies — everything in GlobalFeatureDeps except `inventory`, which we build here. */
type CallerDeps = Omit<GlobalFeatureDeps, "inventory">;

/**
 * Whether any social experiment would run on this page. The content script
 * calls this before deciding to spin up a headless playhtml instance — on
 * pages where no experiment is active we open no connection at all.
 */
export async function anyGlobalFeatureActive(): Promise<boolean> {
  const states = await getAllFeatureStates();
  return SOCIAL_EXPERIMENTS.some((experiment) => states[experiment.flag].enabled);
}

export async function initGlobalFeatures(
  caller: CallerDeps,
): Promise<() => void> {
  const cleanups: (() => void)[] = [];
  const states = await getAllFeatureStates();

  const manager = new InventoryManager();
  try {
    await manager.load();
  } catch (err) {
    // A storage read failure must not take down the social experiments; continue with an empty held store.
    console.error("[we-were-online] inventory load failed, continuing with empty held store:", err);
  }
  const deps: GlobalFeatureDeps = { ...caller, inventory: manager.api };

  for (const exp of SOCIAL_EXPERIMENTS) {
    if (!states[exp.flag].enabled) continue;
    try {
      const cleanup = await exp.init(deps);
      cleanups.push(cleanup);
    } catch (err) {
      console.error(`[we-were-online] social experiment "${exp.id}" failed:`, err);
    }
  }

  // Mount the satchel surface only if inventory is enabled and at least one item registered.
  if (states.INVENTORY.enabled && manager.api.list().length > 0) {
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
