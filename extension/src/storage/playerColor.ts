// ABOUTME: Persists the participant's primary cursor color for extension UI.
// ABOUTME: Updates local identity storage and best-effort server color sync, signed with the identity key.

import type { PlayerIdentity } from "../types";
import { getConfig } from "./sync";
import {
  getStoredPlayerIdentity,
  saveStoredPlayerIdentity,
  type StoredPlayerIdentity,
} from "./playerIdentity";
import {
  signParticipantColorRequest,
  type ParticipantColorBody,
} from "../utils/participantColorRequest";

/**
 * Sends the color to the Worker. Failures (network errors, 401 for an
 * identity the Worker cannot verify, 5xx) only log: the local color is
 * already saved, and the next startup sync tries again.
 */
async function syncPlayerColor(
  identity: StoredPlayerIdentity,
  color: string,
): Promise<void> {
  try {
    const pid = identity.public.publicKey;
    const signed = await signParticipantColorRequest(identity.privateKey, {
      pid,
      color,
      signedAt: Date.now(),
    });
    const body: ParticipantColorBody = {
      cursor_color: color,
      signedAt: signed.signedAt,
      signature: signed.signature,
    };
    const { workerUrl } = await getConfig();
    const response = await fetch(
      `${workerUrl}/participants/${encodeURIComponent(pid)}`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
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
  const identity = await getStoredPlayerIdentity();
  const color = identity?.public.playerStyle.colorPalette[0];
  if (!identity?.public.publicKey || !color) return;
  await syncPlayerColor(identity, color);
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
  const updatedStored: StoredPlayerIdentity = { ...stored, public: updated };

  await saveStoredPlayerIdentity(updatedStored);

  if (updated.publicKey) {
    await syncPlayerColor(updatedStored, color);
  }

  return updated;
}
