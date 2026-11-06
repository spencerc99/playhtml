// ABOUTME: Persists the participant's primary cursor color for extension UI.
// ABOUTME: Updates local identity storage and best-effort server color sync.

import type { PlayerIdentity } from "../types";
import { getConfig } from "./sync";
import {
  getStoredPlayerIdentity,
  saveStoredPlayerIdentity,
  signPlayerIdentityPayload,
} from "./playerIdentity";

function colorUpdatePayload(pid: string, color: string, version: number): string {
  return `participant-color-v1\n${pid}\n${color}\n${version}`;
}

async function syncPlayerColor(
  pid: string,
  color: string,
  version: number,
  privateKey: JsonWebKey,
): Promise<void> {
  try {
    const { workerUrl } = await getConfig();
    const signature = await signPlayerIdentityPayload(
      privateKey,
      colorUpdatePayload(pid, color, version),
    );
    const response = await fetch(
      `${workerUrl}/participants/${encodeURIComponent(pid)}`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cursor_color: color, version, signature }),
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
  const stored = await getStoredPlayerIdentity();
  const color = stored?.public.playerStyle.colorPalette[0];
  if (!stored?.public.publicKey || !color) return;

  const version = Math.max(Date.now(), (stored.colorSyncVersion ?? 0) + 1);
  await saveStoredPlayerIdentity({ ...stored, colorSyncVersion: version });
  await syncPlayerColor(stored.public.publicKey, color, version, stored.privateKey);
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

  const version = Math.max(Date.now(), (stored.colorSyncVersion ?? 0) + 1);
  await saveStoredPlayerIdentity({
    ...stored,
    public: updated,
    colorSyncVersion: version,
  });

  if (updated.publicKey) {
    await syncPlayerColor(updated.publicKey, color, version, stored.privateKey);
  }

  return updated;
}
