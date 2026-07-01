// ABOUTME: Shared interface for "social experiments" — page-level collective mechanics (bottles, tape, …).
// ABOUTME: Each experiment is self-contained and toggled by a flag so we can try them together or graduate one at a time.

import type { PageDataChannel, PresenceAPI } from "@playhtml/common";
import type { InventoryAPI } from "../inventory/types";

export interface GlobalFeatureDeps {
  createPageData: <T>(name: string, defaultValue: T) => PageDataChannel<T>;
  presence: PresenceAPI;
  playerColor: string;
  playerPid: string;
  inventory: InventoryAPI;
}

export interface SocialExperiment {
  /** Stable id, e.g. "bottles", "quarantine-tape". */
  id: string;
  /** Key in FLAGS that gates this experiment. */
  flag: keyof typeof import("../../flags").FLAGS;
  /** Initialize on the current page. Returns a cleanup function. */
  init(deps: GlobalFeatureDeps): Promise<() => void> | (() => void);
}
