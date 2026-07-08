// ABOUTME: Builds the small player identity object shared through realtime presence.
// ABOUTME: Excludes extension-local profile and key material from page-facing payloads.

import type { PlayerIdentity } from "@playhtml/common";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function toPresencePlayerIdentity(
  identity: unknown,
): PlayerIdentity | undefined {
  if (!isRecord(identity)) return undefined;

  const publicKey = identity.publicKey;
  const playerStyle = identity.playerStyle;
  if (typeof publicKey !== "string" || publicKey.length === 0) {
    return undefined;
  }
  if (!isRecord(playerStyle)) return undefined;

  const colorPalette = playerStyle.colorPalette;
  const publicPalette = Array.isArray(colorPalette)
    ? colorPalette.filter(
        (color): color is string =>
          typeof color === "string" && color.length > 0,
      )
    : [];
  if (publicPalette.length === 0) {
    return undefined;
  }

  const publicIdentity: PlayerIdentity = {
    publicKey,
    playerStyle: {
      colorPalette: publicPalette,
    },
  };

  if (typeof identity.name === "string") {
    publicIdentity.name = identity.name;
  }

  if (typeof playerStyle.cursorStyle === "string") {
    publicIdentity.playerStyle.cursorStyle = playerStyle.cursorStyle;
  }

  return publicIdentity;
}
