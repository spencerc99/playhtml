// ABOUTME: Decides which presence peers are still connected and whose stamps to refresh.
// ABOUTME: Pure policy for the presence room's liveness sweep and join snapshots.
import {
  ELEMENT_CHANNEL_PREFIX,
  PAGE_PRESENCE_CHANNEL_PREFIX,
  PRESENCE_STALE_MS,
} from "@playhtml/common";

// Clients ping every 10 s (PRESENCE_PING_INTERVAL_MS). The runtime answers each
// ping without waking the room, so a socket's liveness is read from the
// runtime's auto-response timestamp during a sweep.
//
// A pinging peer counts as connected while its last activity (ping or message)
// is at most this old. It tolerates one late ping.
export const PRESENCE_ACTIVITY_WINDOW_MS = 20_000;
// While at least two sockets are open the room wakes this often to refresh the
// stamps of connected, pinging peers. A peer that stops pinging keeps its last
// stamp, so viewers hide it PRESENCE_STALE_MS later.
export const PRESENCE_SWEEP_INTERVAL_MS = 15_000;
// Only stamps at least this old are refreshed, so a peer that is publishing on
// its own is not rebroadcast by the sweep.
export const PRESENCE_RESTAMP_AGE_MS = 5_000;
// A socket that answered pings before and then went silent this long is
// closed, which removes its presence for everyone. Background tabs throttle
// their timers to about one ping a minute, so this stays well above that.
export const PRESENCE_DEAD_SOCKET_MS = 5 * 60_000;

// The worst stamp age a viewer can see is a restamp age plus a sweep interval.
if (PRESENCE_RESTAMP_AGE_MS + PRESENCE_SWEEP_INTERVAL_MS >= PRESENCE_STALE_MS) {
  throw new Error("Presence sweep cannot keep stamps inside the stale window");
}

export type PresenceLivenessInput = {
  // When the runtime last answered this socket's ping, or null if it never has.
  pingedAt: number | null;
  // When this room instance last handled a message from the socket.
  lastMessageAt: number | null;
  openedAt: number | null;
};

function getLastActivity(input: PresenceLivenessInput): number | null {
  const times = [input.pingedAt, input.lastMessageAt, input.openedAt].filter(
    (value): value is number => value !== null
  );
  return times.length === 0 ? null : Math.max(...times);
}

// Peers that do not ping refresh their own stamps (older clients), so the
// sweep only vouches for peers that ping.
export function isVouchedPresencePeer(
  input: PresenceLivenessInput,
  now: number
): boolean {
  if (input.pingedAt === null) return false;
  const lastActivity = getLastActivity(input);
  return (
    lastActivity !== null && now - lastActivity <= PRESENCE_ACTIVITY_WINDOW_MS
  );
}

export function isDeadPresenceSocket(
  input: PresenceLivenessInput,
  now: number
): boolean {
  if (input.pingedAt === null) return false;
  const lastActivity = getLastActivity(input);
  return lastActivity !== null && now - lastActivity > PRESENCE_DEAD_SOCKET_MS;
}

function isRefreshedChannel(channel: string): boolean {
  return (
    channel.startsWith(ELEMENT_CHANNEL_PREFIX) ||
    channel.startsWith(PAGE_PRESENCE_CHANNEL_PREFIX)
  );
}

function getStamp(value: unknown): number | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const at = (value as Record<string, unknown>).at;
  return typeof at === "number" && Number.isFinite(at) ? at : null;
}

// The channels of a vouched peer whose stamps need refreshing, with the new
// values. Cursor and other channels keep their own stamps: an idle cursor is
// meant to fade.
export function getRestampedChannels(
  channels: Record<string, unknown>,
  now: number
): Record<string, unknown> {
  const restamped: Record<string, unknown> = {};
  for (const [channel, value] of Object.entries(channels)) {
    if (!isRefreshedChannel(channel)) continue;
    const at = getStamp(value);
    if (at === null || now - at < PRESENCE_RESTAMP_AGE_MS) continue;
    restamped[channel] = { ...(value as Record<string, unknown>), at: now };
  }
  return restamped;
}

export function shouldSweepPresenceRoom(openConnectionCount: number): boolean {
  return openConnectionCount >= 2;
}
