// ABOUTME: Builds PlayHTML configuration for the shared Internet Commute room.
// ABOUTME: Reuses the extension identity when one is available to keep cursor color stable.

import type { PlayerIdentity } from "@playhtml/common";

export function createCommuteInitOptions(
  playerIdentity: PlayerIdentity | null,
  trainId: string,
) {
  return {
    room: `wwo-internet-commute-train-${trainId}`,
    cursors: {
      enabled: true,
      enableChat: false,
      coordinateMode: "absolute" as const,
    },
    ...(playerIdentity ? { playerIdentity } : {}),
  };
}
