// ABOUTME: Registers locally persistent scissors as an inventory-backed social experiment.
// ABOUTME: Keeps the prototype behind the internal development gate while using the real page runtime.

import browser from "webextension-polyfill";
import {
  SCISSORS_ITEM_ID,
  ScissorsController,
} from "../scissors/ScissorsController";
import type { GlobalFeatureDeps, SocialExperiment } from "./types";

export const scissorsExperiment: SocialExperiment = {
  id: "scissors",
  flag: "SCISSORS",
  async init(deps: GlobalFeatureDeps) {
    deps.inventory.register({
      id: SCISSORS_ITEM_ID,
      tier: "system",
      label: "Scissors — drag to cut; Delete to undo",
      icon: browser.runtime.getURL("inventory/scissors.svg"),
      accent: deps.playerColor,
    });

    const controller = new ScissorsController(deps.inventory);
    await controller.init();
    return () => controller.destroy();
  },
};
