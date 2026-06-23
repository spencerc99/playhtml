// ABOUTME: Provides core-library runtime guards for presence transport values.
// ABOUTME: Keeps cursor presence parsing readable without expanding public APIs.

import type { Cursor, CursorZonePosition, PlayerIdentity } from "@playhtml/common";

export type PresenceCursorChannelValue = {
  cursor?: Cursor | null;
  zone?: CursorZonePosition | null;
  page?: string;
  at?: number;
};

export function isPresenceRecord(
  value: unknown,
): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function isPlayerIdentity(value: unknown): value is PlayerIdentity {
  if (!isPresenceRecord(value)) return false;
  if (typeof value.publicKey !== "string" || value.publicKey.length === 0) {
    return false;
  }
  const style = value.playerStyle;
  return (
    isPresenceRecord(style) &&
    Array.isArray(style.colorPalette) &&
    typeof style.colorPalette[0] === "string" &&
    style.colorPalette[0].length > 0
  );
}

export function isCursor(value: unknown): value is Cursor {
  return (
    isPresenceRecord(value) &&
    Number.isFinite(value.x) &&
    Number.isFinite(value.y) &&
    typeof value.pointer === "string" &&
    value.pointer.length > 0
  );
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
