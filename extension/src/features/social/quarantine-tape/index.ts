// ABOUTME: Quarantine tape registered as a social experiment. Registers two rolls (slop, spam) as armable items.
// ABOUTME: Arming a roll drives the QuarantineTapeManager's on-page overlay + edge glow for that tape type.

import { QuarantineTapeManager } from "./QuarantineTapeManager";
import type { TapeType } from "./types";
import type { GlobalFeatureDeps, SocialExperiment } from "../types";

const ITEM_SLOP = "quarantine-tape-slop";
const ITEM_SPAM = "quarantine-tape-spam";

const ITEM_TYPE: Record<string, TapeType> = {
  [ITEM_SLOP]: "slop",
  [ITEM_SPAM]: "spam",
};

/**
 * A hazard-swatch roll icon as an inline data URI (no binary asset needed). A
 * diagonally-hatched square in the tape's colors: amber/black for slop, red/white
 * for spam.
 */
function rollIcon(base: string, mark: string): string {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">` +
    `<defs><pattern id="h" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">` +
    `<rect width="8" height="8" fill="${base}"/><rect width="4" height="8" fill="${mark}"/></pattern></defs>` +
    `<circle cx="16" cy="16" r="15" fill="url(#h)" stroke="${mark}" stroke-width="1.5"/>` +
    `<circle cx="16" cy="16" r="5" fill="none" stroke="${mark}" stroke-width="2"/>` +
    `</svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

export const quarantineTapeExperiment: SocialExperiment = {
  id: "quarantine-tape",
  flag: "QUARANTINE_TAPE",
  async init(deps: GlobalFeatureDeps) {
    const manager = new QuarantineTapeManager(deps.playerPid);

    deps.inventory.register({
      id: ITEM_SLOP,
      tier: "system",
      label: "Quarantine tape — AI slop",
      icon: rollIcon("#f0a92b", "#161616"),
      accent: "#f0a92b",
      // The tape draws its own armed overlay (edge glow + preview), so the
      // generic wield-beside-cursor icon is suppressed for it.
      ownsArmedCursor: true,
    });
    deps.inventory.register({
      id: ITEM_SPAM,
      tier: "system",
      label: "Quarantine tape — SEO spam",
      icon: rollIcon("#f6f1ea", "#d62828"),
      accent: "#d62828",
      ownsArmedCursor: true,
    });

    // Esc while armed disarms through the inventory so the satchel stays in sync.
    manager.onDisarmRequest = () => deps.inventory.disarm();

    const off = deps.inventory.onArmedChange((tool) => {
      const type = tool ? ITEM_TYPE[tool.itemId] ?? null : null;
      manager.setEquipped(type);
    });

    const cleanupOverlay = await manager.init();

    return () => {
      off();
      cleanupOverlay();
    };
  },
};
