// ABOUTME: Persists the participant's primary cursor color for extension UI.
// ABOUTME: Updates local identity storage and best-effort server color sync.

import type { PlayerIdentity } from "../types";
import { getConfig } from "./sync";
import {
  getPublicPlayerIdentity,
  getStoredPlayerIdentity,
  saveStoredPlayerIdentity,
} from "./playerIdentity";

async function syncPlayerColor(pid: string, color: string): Promise<void> {
  try {
    const { workerUrl } = await getConfig();
    const response = await fetch(
      `${workerUrl}/participants/${encodeURIComponent(pid)}`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cursor_color: color }),
      },
    );

    if (!response.ok) {
      console.warn("[Sync] Failed to sync participant color:", response.status);
    }
  } catch (error) {
    console.warn("[Sync] Failed to sync participant color:", error);
  }
}

export async function syncStoredPlayerColor(): Promise<void> {
  const identity = await getPublicPlayerIdentity();
  const color = identity?.playerStyle.colorPalette[0];
  if (!identity?.publicKey || !color) return;
  await syncPlayerColor(identity.publicKey, color);
}

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
    await syncPlayerColor(updated.publicKey, color);
  }

  return updated;
}
