// ABOUTME: Calculates how often cursor awareness should publish over the network.
// ABOUTME: Keeps per-room cursor traffic bounded while small rooms stay at 60Hz.

const MAX_CURSOR_NETWORK_HZ = 60;
const MIN_CURSOR_NETWORK_HZ = 12;
const CURSOR_ROOM_NETWORK_BUDGET_HZ = 480;

export function getCursorNetworkHz(activeCursorCount: number): number {
  const participantCount = Math.max(1, Math.ceil(activeCursorCount));
  const budgetedHz = CURSOR_ROOM_NETWORK_BUDGET_HZ / participantCount;

  return Math.max(
    MIN_CURSOR_NETWORK_HZ,
    Math.min(MAX_CURSOR_NETWORK_HZ, budgetedHz),
  );
}

export function getCursorNetworkIntervalMs(activeCursorCount: number): number {
  return 1000 / getCursorNetworkHz(activeCursorCount);
}
