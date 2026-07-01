// ABOUTME: Persists the participant's primary cursor color for extension UI.
// ABOUTME: Updates local identity storage and best-effort server color sync.

import browser from "webextension-polyfill";
import type { PlayerIdentity } from "../types";
import { syncParticipantColor } from "./sync";

export async function savePlayerColor(color: string): Promise<PlayerIdentity | null> {
  const { playerIdentity: stored } = await browser.storage.local.get([
    "playerIdentity",
  ]);

  if (!stored) return null;

  const identity = stored as PlayerIdentity;
  const colorPalette = Array.isArray(identity.playerStyle?.colorPalette)
    ? [...identity.playerStyle.colorPalette]
    : [];
  colorPalette[0] = color;

  const updated: PlayerIdentity = {
    ...identity,
    playerStyle: {
      ...identity.playerStyle,
      colorPalette,
    },
  };

  await browser.storage.local.set({ playerIdentity: updated });

  if (updated.publicKey) {
    try {
      await syncParticipantColor(updated.publicKey, color);
    } catch {}
  }

  return updated;
}
