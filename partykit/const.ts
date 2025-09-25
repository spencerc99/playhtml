// Storage key constants for consistency
export const STORAGE_KEYS = {
  // Stores consumer room ids and the elementIds they are interested in
  subscribers: "subscribers",
  // Stores references out to other source rooms that this source room is interested in
  sharedReferences: "sharedReferences",
  sharedPermissions: "sharedPermissions",
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
