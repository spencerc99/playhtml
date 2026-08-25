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
  // Requires the next successful hydration to reset clients that saw transient state
  persistenceRecoveryPending: "persistenceRecoveryPending",
  // Stores the next time a connected large room should pay the expensive
  // compactability check
  emergencyCompactCheckAfter: "emergencyCompactCheckAfter",
  // Stores the next time autosave should try compacting before persistence
  persistedDocumentCompactCheckAfter: "persistedDocumentCompactCheckAfter",
  // Stores the quarantine record for a room whose persisted document cannot be
  // hydrated without crashing the Durable Object
  quarantine: "quarantine",
  // Counts hydration attempts that started but never reported completion
  quarantineLoadAttempts: "quarantineLoadAttempts",
  // Counts generic alarm runs that started but never reported completion.
  alarmFailureAttempts: "alarmFailureAttempts",
  // Earliest time each risky operation may be retried after repeated failures.
  // Load and alarm keep separate deadlines so a success on one never erases the
  // other's backoff.
  loadRetryAfter: "loadRetryAfter",
  alarmRetryAfter: "alarmRetryAfter",
  // Tracks automatic compaction attempts that started but never completed.
  compactionAttempts: "compactionAttempts",
  // Earliest time a failed automatic compaction may be retried.
  compactionRetryAfter: "compactionRetryAfter",
  // Timestamp set after automatic compaction vanishes three times in a row.
  compactionDisabledAt: "compactionDisabledAt",
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
// Connected rooms compact only as a high-watermark safety valve. The size check
// itself is cheap because autosave already has the encoded document, but the
// compactability check walks and rebuilds the Y.Doc, so it is rate-limited.
export const DEFAULT_EMERGENCY_COMPACT_CHECK_BYTES = (() => {
  return 1024 * 1024 * 16;
})();
export const DEFAULT_EMERGENCY_COMPACT_RECHECK_DELAY_MS = (() => {
  return 60 * 60 * 1000;
})();
export const DEFAULT_MESSAGE_RATE_WINDOW_MS = (() => {
  return 1000;
})();
export const DEFAULT_MESSAGE_RATE_LIMIT = (() => {
  return 1000;
})();
export const DEFAULT_MAX_REQUEST_BYTES = (() => {
  return 1024 * 1024 * 16;
})();
// Pre-persist compaction runs before writing oversized autosave candidates so
// persisted snapshots stay below the startup-risk range seen in live rooms.
export const DEFAULT_PERSISTED_DOCUMENT_COMPACT_BYTES = (() => {
  return 1024 * 1024 * 8;
})();
export const DEFAULT_DOCUMENT_WARNING_BYTES = (() => {
  return 1024 * 1024 * 40;
})();
// Documents above this size are reported as a load risk. Lethality varies with
// isolate co-tenancy: 7-8MB rooms have OOMed, but healthy production rooms also
// sit in the 6-8MB band, so size alone never blocks a load or quarantines a
// room. It is a warning; repeated real failures are what drive backoff.
export const DEFAULT_QUARANTINE_DOCUMENT_BYTES = (() => {
  return 1024 * 1024 * 10;
})();
// Automatic compaction gets two delayed retries after the initial attempt.
// A third vanished attempt disables automatic compaction for that room.
export const DEFAULT_COMPACTION_RETRY_DELAYS_MS = [15_000, 30_000] as const;
export const DEFAULT_COMPACTION_DISABLE_AFTER = 3;
// Consecutive failures of the same risky operation before the room is
// quarantined as a last resort. The backoff ladder below is expected to absorb
// transient failures long before this is reached.
export const DEFAULT_QUARANTINE_FAILURE_THRESHOLD = (() => {
  return 8;
})();
// Retry backoff for risky work that keeps failing. Cloudflare retries a failed
// alarm within seconds, which is what turns one OOM into a crash loop, so the
// alarm is rescheduled onto this ladder instead: 1min, 5min, 20min, 1h, 6h,
// then capped. Failures self-heal -- a success clears the counter and restores
// the normal cadence.
export const DEFAULT_FAILURE_BACKOFF_MS = (() => {
  return 60 * 1000;
})();
export const DEFAULT_FAILURE_BACKOFF_MAX_MS = (() => {
  return 60 * 60 * 1000 * 24;
})();
export const DEFAULT_SUPABASE_LOAD_TIMEOUT_MS = (() => {
  return 5000;
})();
export const DEFAULT_SUPABASE_LOAD_ATTEMPTS = (() => {
  return 3;
})();
export const DEFAULT_SUPABASE_LOAD_RETRY_DELAY_MS = (() => {
  return 250;
})();
export const ORIGIN_S2C = "__bridge_s2c__";
export const ORIGIN_C2S = "__bridge_c2s__";

export type Subscriber = {
  consumerRoomId: string;
  elementIds?: string[];
  consumerResetEpoch?: number | null;
  createdAt?: string;
  lastSeen?: string;
  leaseMs?: number;
};

export type SharedRefEntry = {
  sourceRoomId: string;
  elementIds: string[];
  sourceResetEpoch?: number | null;
  lastSeen?: string;
};

export function ensureExists<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) {
    throw new Error("ensureExists: value is null or undefined");
  }
  return value;
}
