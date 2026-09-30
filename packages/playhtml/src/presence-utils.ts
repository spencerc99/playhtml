// ABOUTME: Provides core-library runtime guards and shared helpers for presence.
// ABOUTME: A dependency-free leaf module so transport consumers avoid duplication.

import {
  ELEMENT_CHANNEL_PREFIX,
  isCursor,
  isPlayerIdentity,
  isPresenceRecord,
  MAX_PRESENCE_VALUE_BYTES,
  PAGE_PRESENCE_CHANNEL_PREFIX,
  PRESENCE_STALE_MS,
  type Cursor,
  type CursorZonePosition,
} from "@playhtml/common";

export type PresenceCursorChannelValue = {
  cursor?: Cursor | null;
  zone?: CursorZonePosition | null;
  page?: string;
  at?: number;
};

export { isCursor, isPlayerIdentity, isPresenceRecord };

// Reserved presence channel names and the prefixes used to namespace the rest.
// Shared so the transport, the PeerStore, and every view agree on wire names
// without redeclaring the strings (a channel name is protocol, not local).
export const IDENTITY_CHANNEL = "identity";
export { ELEMENT_CHANNEL_PREFIX, PAGE_PRESENCE_CHANNEL_PREFIX };

// PresenceView's trusted system fields. A custom presence channel must never
// use these names: they are populated from validated identity/cursor state, and
// letting a peer publish `presence:playerIdentity` (etc.) would let them spoof
// another user's identity, cursor, or isMe flag in the built PresenceView.
// Rejected on write (DX) and skipped on fold (the security boundary).
export const RESERVED_PRESENCE_FIELDS = new Set([
  "playerIdentity",
  "cursor",
  "isMe",
]);

export function isReservedPresenceField(name: string): boolean {
  return RESERVED_PRESENCE_FIELDS.has(name);
}

export function isElementChannel(channel: string): boolean {
  return channel.startsWith(ELEMENT_CHANNEL_PREFIX);
}

export function isPagePresenceChannel(channel: string): boolean {
  return channel.startsWith(PAGE_PRESENCE_CHANNEL_PREFIX);
}

/** `status` -> `presence:status` (page presence wire channel). */
export function toPagePresenceChannel(channel: string): string {
  return `${PAGE_PRESENCE_CHANNEL_PREFIX}${channel}`;
}

/** `presence:status` -> `status` (page presence wire channel). */
export function fromPagePresenceChannel(channel: string): string {
  return channel.slice(PAGE_PRESENCE_CHANNEL_PREFIX.length);
}

// Client-side staleness backstop, shared by cursors, element awareness, and
// page presence. Yjs awareness dropped peers that went quiet for ~30s even when
// the server never saw the disconnect (killed tab, dropped network, lid close);
// the transport views reproduce that by stamping publications with `at` and
// age-filtering against PRESENCE_STALE_MS. Peers re-stamp on every publish.
// While a peer's liveness pings are answered, the presence server re-stamps its
// element and page presence channels; against a server that does not answer
// pings, the peer re-stamps them itself on the keepalive below. Either way
// only genuinely-gone peers expire.
export { PRESENCE_STALE_MS };
// Re-stamp interval: comfortably under PRESENCE_STALE_MS so a quiet-but-
// connected peer keeps its presence alive across the window.
export const PRESENCE_KEEPALIVE_MS = 10_000;
// Liveness ping interval. Pings are answered without waking the server, and
// the server treats a peer as connected while pings keep arriving.
export const PRESENCE_PING_INTERVAL_MS = 10_000;
// How long after a ping the client waits for a pong before concluding the
// server does not answer pings.
export const PRESENCE_PONG_TIMEOUT_MS = 5_000;

/** True when a publication's `at` timestamp is within the staleness window.
 * A missing/non-finite `at` is treated as fresh (older peers that never stamp
 * must not vanish — the field is new in this release). */
export function isFreshTimestamp(
  at: unknown,
  now: number,
  maxAgeMs: number = PRESENCE_STALE_MS,
): boolean {
  if (!Number.isFinite(at)) return true;
  return now - Number(at) <= maxAgeMs;
}

/**
 * True when a folded channel value is still "live" — i.e. its stamped `at` is
 * within the staleness window. A value with no `at` (unstamped channel like
 * identity, or an older peer) is always live: only stamped channels expire.
 */
export function isLiveChannel(
  value: unknown,
  now: number,
  maxAgeMs: number = PRESENCE_STALE_MS,
): boolean {
  if (!isPresenceRecord(value)) return true;
  if (!("at" in value)) return true;
  return isFreshTimestamp(value.at, now, maxAgeMs);
}

/**
 * Run `republish` every intervalMs (default well under the staleness window) so
 * a quiet-but-connected peer's last-published channels get a fresh `at` before
 * they age out. Returns a stop function. The single source of the keepalive
 * cadence, shared by element awareness and page presence.
 */
export function startPresenceKeepalive(
  republish: () => void,
  intervalMs: number = PRESENCE_KEEPALIVE_MS,
): () => void {
  const handle = setInterval(() => {
    republish();
  }, intervalMs);
  return () => clearInterval(handle);
}

/** Wire envelope for a page-presence channel value: the user's payload plus the
 * staleness timestamp. `value` is arbitrary user data (primitive, array, or
 * object), so `at` is a sibling field rather than spread in — that keeps the
 * payload round-tripping byte-for-byte and avoids colliding with a user field
 * literally named `at`. */
export type PagePresenceEnvelope = { at: number; value: unknown };

export function wrapPagePresenceValue(
  value: unknown,
  now: number = Date.now(),
): PagePresenceEnvelope {
  return { at: now, value };
}

/** Extract the user payload from a folded page-presence channel value. Tolerates
 * an un-enveloped value (older peer) by returning it as-is. */
export function unwrapPagePresenceValue(folded: unknown): unknown {
  if (isPresenceRecord(folded) && "value" in folded && "at" in folded) {
    return (folded as PagePresenceEnvelope).value;
  }
  return folded;
}

/**
 * Byte length of a value's JSON. Infinity when the value cannot be serialized,
 * so callers reject it against the presence value byte cap without special-
 * casing undefined/cyclic values.
 */
export function jsonByteLength(value: unknown): number {
  try {
    const json = JSON.stringify(value);
    if (json === undefined) return Infinity;
    return new TextEncoder().encode(json).byteLength;
  } catch {
    return Infinity;
  }
}

/** The publicKey a folded peer advertised on its identity channel, or undefined. */
export function getPeerPublicKey(
  channels: Record<string, unknown>,
): string | undefined {
  const identity = channels[IDENTITY_CHANNEL];
  return isPresenceRecord(identity) && typeof identity.publicKey === "string"
    ? identity.publicKey
    : undefined;
}

/** The channel write surface both presence clients publish through. */
export type PresenceChannelWriter = {
  update(channel: string, value: unknown): void;
  clear(channel: string): void;
};

/**
 * Publish a value on a channel, enforcing the presence value byte cap and
 * swallowing transport errors so one bad channel can't break a batch. Returns
 * true when the update was sent. `label` disambiguates the log source
 * (e.g. "presence", "element awareness").
 */
export function publishPresenceValue(
  writer: PresenceChannelWriter,
  channel: string,
  value: unknown,
  label: string,
): boolean {
  if (jsonByteLength(value) > MAX_PRESENCE_VALUE_BYTES) {
    console.warn(
      `[playhtml] Failed to publish ${label}:`,
      new Error(
        `Presence value must be ${MAX_PRESENCE_VALUE_BYTES} bytes or less`,
      ),
    );
    return false;
  }
  try {
    writer.update(channel, value);
    return true;
  } catch (error) {
    console.warn(`[playhtml] Failed to publish ${label}:`, error);
    return false;
  }
}

/** Clear a channel, swallowing transport errors (see publishPresenceValue). */
export function clearPresenceChannel(
  writer: PresenceChannelWriter,
  channel: string,
  label: string,
): void {
  try {
    writer.clear(channel);
  } catch (error) {
    console.warn(`[playhtml] Failed to clear ${label}:`, error);
  }
}

/**
 * Invoke a consumer/user callback in a fan-out, isolating a throw so it can't
 * skip the remaining listeners (and, on a shared socket, couple otherwise
 * independent consumers). Mirrors users.ts notifySubscribers. `source` names the
 * dispatch site in the logged error. Returns true when the callback did not
 * throw, so callers can defer committing per-listener state (e.g. a fingerprint)
 * until delivery succeeds and a transient throw is retried on the next emit.
 */
export function safeInvoke(fn: () => void, source: string): boolean {
  try {
    fn();
    return true;
  } catch (error) {
    console.error(`[playhtml] ${source} callback threw:`, error);
    return false;
  }
}

export function isPresenceCursorChannelValue(
  value: unknown,
): value is PresenceCursorChannelValue {
  return isPresenceRecord(value) && "cursor" in value;
}

export function isPresenceSnapshot(
  value: unknown,
): value is Record<string, Record<string, unknown>> {
  if (!isPresenceRecord(value)) return false;
  return Object.values(value).every(isPresenceRecord);
}

export function isPresenceRemoves(
  value: unknown,
): value is Record<string, string[]> {
  if (!isPresenceRecord(value)) return false;
  return Object.values(value).every(
    (channels) =>
      Array.isArray(channels) &&
      channels.every((channel) => typeof channel === "string"),
  );
}

export function getNullableString(value: unknown): string | null {
  if (value == null) return null;
  return typeof value === "string" ? value : null;
}

export function getOptionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}
