// ABOUTME: Defines storage keys, timing constants, and shared bridge types for PartyServer.
// ABOUTME: Keeps Durable Object room metadata and lease timing consistent across modules.
// Storage key constants for consistency
export const STORAGE_KEYS = {
  // Stores consumer room ids and the elementIds they are interested in
  subscribers: "subscribers",
  // Stores references out to other source rooms that this source room is interested in
  sharedReferences: "sharedReferences",
  sharedPermissions: "sharedPermissions",
  // Stores the reset epoch timestamp to detect when a room was reset
  resetEpoch: "resetEpoch",
  // Stores a timestamp after which an empty room can compact its Y.Doc history
  emptyRoomCompactAfter: "emptyRoomCompactAfter",
};
// Subscriber lease configuration (default 12 hours)
export const DEFAULT_SUBSCRIBER_LEASE_MS = (() => {
  return 60 * 60 * 1000 * 12;
})();
// Prune interval configuration (default 6 hours). See PartyKit alarms guide:
// https://docs.partykit.io/guides/scheduling-tasks-with-alarms/
export const DEFAULT_PRUNE_INTERVAL_MS = (() => {
  return 60 * 60 * 1000 * 4;
})();
// Empty-room compaction waits so transient reconnects do not trigger reloads.
export const DEFAULT_EMPTY_ROOM_COMPACT_DELAY_MS = (() => {
  return 60 * 1000 * 5;
})();
export const ORIGIN_S2C = "__bridge_s2c__";
export const ORIGIN_C2S = "__bridge_c2s__";

export type Subscriber = {
  consumerRoomId: string;
  elementIds?: string[];
  createdAt?: string;
  lastSeen?: string;
  leaseMs?: number;
};

export type SharedRefEntry = {
  sourceRoomId: string;
  elementIds: string[];
  lastSeen?: string;
};

export function ensureExists<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) {
    throw new Error("ensureExists: value is null or undefined");
  }
  return value;
}
