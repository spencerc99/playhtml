// ABOUTME: Provides core-library runtime guards for presence transport values.
// ABOUTME: Keeps cursor presence parsing readable without expanding public APIs.

import type { Cursor, CursorZonePosition } from "@playhtml/common";
import {
  isCursor,
  isPlayerIdentity,
  isPresenceRecord,
} from "@playhtml/common";

export type PresenceCursorChannelValue = {
  cursor?: Cursor | null;
  zone?: CursorZonePosition | null;
  page?: string;
  at?: number;
};

export { isCursor, isPlayerIdentity, isPresenceRecord };

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
