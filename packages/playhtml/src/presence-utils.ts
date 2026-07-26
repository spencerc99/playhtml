// ABOUTME: Provides core-library runtime guards and shared helpers for presence.
// ABOUTME: A dependency-free leaf module so transport consumers avoid duplication.

import {
  isCursor,
  isPlayerIdentity,
  isPresenceRecord,
  MAX_PRESENCE_VALUE_BYTES,
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
export const ELEMENT_CHANNEL_PREFIX = "element:";
export const PAGE_PRESENCE_CHANNEL_PREFIX = "presence:";

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
