// ABOUTME: Defines which homepage visitors count as recently present.
// ABOUTME: Keeps the homepage presence timeout and filtering rules in one place.

export const HOMEPAGE_PRESENCE_TIMEOUT_MS = 10 * 60 * 1000;

export type HomepagePresenceAwareness = {
  color: string;
  lastActiveAt: number;
  playerId: string;
};

export function getRecentHomepagePresences(
  presences: Iterable<HomepagePresenceAwareness>,
  now: number,
): HomepagePresenceAwareness[] {
  const recentByPlayerId = new Map<string, HomepagePresenceAwareness>();

  for (const presence of presences) {
    if (
      !presence.playerId ||
      !Number.isFinite(presence.lastActiveAt) ||
      now - presence.lastActiveAt > HOMEPAGE_PRESENCE_TIMEOUT_MS
    ) {
      continue;
    }

    const current = recentByPlayerId.get(presence.playerId);
    if (!current || presence.lastActiveAt > current.lastActiveAt) {
      recentByPlayerId.set(presence.playerId, presence);
    }
  }

  return Array.from(recentByPlayerId.values());
}
