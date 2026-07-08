// ABOUTME: Persists the participant's primary cursor color for extension UI.
// ABOUTME: Updates local identity storage and best-effort server color sync.

import type { PlayerIdentity } from "../types";
import { syncParticipantColor } from "./sync";
import {
  getStoredPlayerIdentity,
  saveStoredPlayerIdentity,
} from "./playerIdentity";

export async function savePlayerColor(color: string): Promise<PlayerIdentity | null> {
  const stored = await getStoredPlayerIdentity();

  if (!stored) return null;

  const colorPalette = Array.isArray(stored.public.playerStyle?.colorPalette)
    ? [...stored.public.playerStyle.colorPalette]
    : [];
  colorPalette[0] = color;

  const updated: PlayerIdentity = {
    ...stored.public,
    playerStyle: {
      ...stored.public.playerStyle,
      colorPalette,
    },
  };

  await saveStoredPlayerIdentity({
    ...stored,
    public: updated,
  });

  if (updated.publicKey) {
    try {
      await syncParticipantColor(updated.publicKey, color);
    } catch {}
  }

  return updated;
}
