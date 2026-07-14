// ABOUTME: Registers the locally persistent hammer as an inventory-backed social experiment.
// ABOUTME: Keeps the prototype behind the internal development gate while using the real page runtime.

import browser from "webextension-polyfill";
import { HAMMER_ITEM_ID, HammerController } from "../hammer/HammerController";
import type { GlobalFeatureDeps, SocialExperiment } from "./types";

export const hammerExperiment: SocialExperiment = {
  id: "hammer",
  flag: "HAMMER",
  async init(deps: GlobalFeatureDeps) {
    deps.inventory.register({
      id: HAMMER_ITEM_ID,
      tier: "system",
      label: "Hammer — click to dent; Delete to undo",
      icon: browser.runtime.getURL("inventory/hammer.svg"),
      accent: deps.playerColor,
    });

    const controller = new HammerController(deps.inventory);
    await controller.init();
    return () => controller.destroy();
  },
};
