// ABOUTME: Calculates how often cursor presence should publish over the network.
// ABOUTME: Keeps per-room cursor traffic bounded while small rooms stay at 60Hz.

const MAX_CURSOR_NETWORK_HZ = 60;
const CONGESTED_CURSOR_NETWORK_HZ = 30;
const FULL_RATE_CURSOR_CONNECTIONS = 30;
const CURSOR_ROOM_FANOUT_BUDGET = 150_000;

export function getCursorNetworkHz(activeCursorCount: number): number {
  const participantCount = Math.max(1, Math.ceil(activeCursorCount));

  if (participantCount <= FULL_RATE_CURSOR_CONNECTIONS) {
    return MAX_CURSOR_NETWORK_HZ;
  }

  return Math.min(
    CONGESTED_CURSOR_NETWORK_HZ,
    CURSOR_ROOM_FANOUT_BUDGET / (participantCount * (participantCount - 1)),
  );
}

export function getCursorNetworkIntervalMs(activeCursorCount: number): number {
  return 1000 / getCursorNetworkHz(activeCursorCount);
}
