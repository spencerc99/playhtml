// ABOUTME: Defines generic realtime presence messages shared by clients and servers.
// ABOUTME: Validates ephemeral channel updates before they enter PlayHTML rooms.

import type { Cursor, CursorZonePosition, PlayerIdentity } from "./cursor-types";

export const MAX_PRESENCE_VALUE_BYTES = 4096;
export const MAX_PRESENCE_PAGE_LENGTH = 512;
export const MAX_PRESENCE_IDENTITY_STRING_LENGTH = 512;

export type PresenceChannelCadence = "frame" | "interactive" | "event";

export type PresenceJoinMessage = {
  type: "presence-join";
  identity?: PlayerIdentity;
  page?: string;
};

export type PresenceUpdateMessage = {
  type: "presence-update";
  channel: string;
  value: unknown;
};

export type PresenceClearMessage = {
  type: "presence-clear";
  channel: string;
};

export type PresencePingMessage = {
  type: "presence-ping";
};

export type PresenceClientMessage =
  | PresenceJoinMessage
  | PresenceUpdateMessage
  | PresenceClearMessage
  | PresencePingMessage;

export type PresenceSnapshot = Record<string, Record<string, unknown>>;

export type PresenceSyncMessage = {
  type: "presence-sync";
  peers: PresenceSnapshot;
};

export type PresenceChangesMessage = {
  type: "presence-changes";
  updates: PresenceSnapshot;
  removes: Record<string, string[]>;
};

export type PresenceRateMessage = {
  type: "presence-rate";
  channel: string;
  hz: number;
};

export type PresenceErrorMessage = {
  type: "presence-error";
  message: string;
};

export type PresenceServerMessage =
  | PresenceSyncMessage
  | PresenceChangesMessage
  | PresenceRateMessage
  | PresenceErrorMessage;

export type CursorPresenceValue = {
  cursor: Cursor | null;
  zone?: CursorZonePosition | null;
  page?: string;
  at?: number;
};

export function getPresenceChannelCadence(
  channel: string,
): PresenceChannelCadence {
  if (channel === "cursor") return "frame";
  if (channel.startsWith("element:")) return "interactive";
  return "event";
}

export function validatePresenceClientMessage(
  value: unknown,
): PresenceClientMessage {
  if (!isPresenceRecord(value)) {
    throw new Error("Presence message must be an object");
  }

  switch (value.type) {
    case "presence-join":
      validatePresenceJoinMessage(value);
      return value as PresenceJoinMessage;
    case "presence-update":
      validateChannel(value.channel);
      validatePresenceValue(value.channel, value.value);
      return value as PresenceUpdateMessage;
    case "presence-clear":
      validateChannel(value.channel);
      return value as PresenceClearMessage;
    case "presence-ping":
      return value as PresencePingMessage;
    default:
      throw new Error("Unsupported presence message type");
  }
}

function validatePresenceJoinMessage(value: Record<string, unknown>): void {
  assertJsonSize(value);
  validateOptionalBoundedString(value.page, "page", MAX_PRESENCE_PAGE_LENGTH);
  if (value.identity !== undefined) {
    validatePlayerIdentity(value.identity);
  }
}

function validatePresenceValue(channel: unknown, value: unknown): void {
  if (value === undefined) {
    throw new Error("Presence value must not be undefined");
  }

  assertJsonSize(value);

  if (channel === "cursor") {
    validateCursorPresenceValue(value);
  }

  if (channel === "identity") {
    validatePlayerIdentity(value);
  }
}

function validateCursorPresenceValue(value: unknown): void {
  if (!isPresenceRecord(value)) {
    throw new Error("cursor presence value must be an object");
  }

  if (!("cursor" in value)) {
    throw new Error("cursor presence value must include cursor");
  }

  if (value.cursor !== null) {
    validateCursor(value.cursor);
  }

  if (value.zone !== undefined && value.zone !== null) {
    validateZone(value.zone);
  }

  validateOptionalBoundedString(value.page, "page", MAX_PRESENCE_PAGE_LENGTH);

  if (value.at !== undefined && !Number.isFinite(value.at)) {
    throw new Error("cursor at must be a finite number");
  }
}

export function isPlayerIdentity(value: unknown): value is PlayerIdentity {
  try {
    assertPlayerIdentity(value);
    return true;
  } catch {
    return false;
  }
}

function validatePlayerIdentity(value: unknown): void {
  assertPlayerIdentity(value);
}

function assertPlayerIdentity(value: unknown): asserts value is PlayerIdentity {
  if (!isPresenceRecord(value)) {
    throw new Error("identity must be an object");
  }
  assertPublicPresenceFields(
    value,
    ["publicKey", "name", "playerStyle", "createdAt"],
    "identity",
  );
  validateRequiredBoundedString(
    value.publicKey,
    "identity.publicKey",
    MAX_PRESENCE_IDENTITY_STRING_LENGTH,
  );
  if (!isPresenceRecord(value.playerStyle)) {
    throw new Error("identity.playerStyle must be an object");
  }
  assertPublicPresenceFields(
    value.playerStyle,
    ["colorPalette", "cursorStyle"],
    "identity.playerStyle",
  );
  const colorPalette = value.playerStyle.colorPalette;
  if (!Array.isArray(colorPalette)) {
    throw new Error("identity.playerStyle.colorPalette must be an array");
  }
  validateRequiredBoundedString(
    colorPalette[0],
    "identity.playerStyle.colorPalette[0]",
    MAX_PRESENCE_IDENTITY_STRING_LENGTH,
  );
  for (let i = 1; i < colorPalette.length; i++) {
    validateRequiredBoundedString(
      colorPalette[i],
      `identity.playerStyle.colorPalette[${i}]`,
      MAX_PRESENCE_IDENTITY_STRING_LENGTH,
    );
  }
  validateOptionalBoundedString(
    value.name,
    "identity.name",
    MAX_PRESENCE_IDENTITY_STRING_LENGTH,
  );
  validateOptionalBoundedString(
    value.playerStyle.cursorStyle,
    "identity.playerStyle.cursorStyle",
    MAX_PRESENCE_IDENTITY_STRING_LENGTH,
  );
  if (value.createdAt !== undefined && !Number.isFinite(value.createdAt)) {
    throw new Error("identity.createdAt must be a finite number");
  }
}

function assertPublicPresenceFields(
  value: Record<string, unknown>,
  allowedFields: string[],
  name: string,
): void {
  for (const key of Object.keys(value)) {
    if (!allowedFields.includes(key)) {
      throw new Error(`${name} must only include public presence fields`);
    }
  }
}

export function isCursor(value: unknown): value is Cursor {
  try {
    assertCursor(value);
    return true;
  } catch {
    return false;
  }
}

function validateCursor(value: unknown): void {
  assertCursor(value);
}

function assertCursor(value: unknown): asserts value is Cursor {
  if (!isPresenceRecord(value)) {
    throw new Error("cursor must be an object");
  }
  if (!Number.isFinite(value.x)) {
    throw new Error("cursor.x must be a finite number");
  }
  if (!Number.isFinite(value.y)) {
    throw new Error("cursor.y must be a finite number");
  }
  if (typeof value.pointer !== "string" || value.pointer.length === 0) {
    throw new Error("cursor.pointer must be a non-empty string");
  }
}

function validateZone(value: unknown): void {
  if (!isPresenceRecord(value)) {
    throw new Error("cursor zone must be an object");
  }
  if (typeof value.zoneId !== "string" || value.zoneId.length === 0) {
    throw new Error("cursor zoneId must be a non-empty string");
  }
  if (!Number.isFinite(value.relX)) {
    throw new Error("cursor zone relX must be a finite number");
  }
  if (!Number.isFinite(value.relY)) {
    throw new Error("cursor zone relY must be a finite number");
  }
}

function validateChannel(value: unknown): asserts value is string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error("Presence channel must be a non-empty string");
  }
  validateStringBounds(value, "Presence channel", 128);
}

function validateRequiredBoundedString(
  value: unknown,
  name: string,
  maxLength: number,
): void {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${name} must be a non-empty string`);
  }
  validateStringBounds(value, name, maxLength);
}

function validateOptionalBoundedString(
  value: unknown,
  name: string,
  maxLength: number,
): void {
  if (value === undefined) return;
  if (typeof value !== "string") {
    throw new Error(`${name} must be a string`);
  }
  validateStringBounds(value, name, maxLength);
}

function validateStringBounds(
  value: string,
  name: string,
  maxLength: number,
): void {
  if (value.length > maxLength) {
    throw new Error(`${name} must be ${maxLength} characters or less`);
  }
  if (/[\u0000-\u001f\u007f]/.test(value)) {
    throw new Error(`${name} must not contain control characters`);
  }
}

function assertJsonSize(value: unknown): void {
  let json: string;
  try {
    json = JSON.stringify(value);
  } catch {
    throw new Error("Presence value must be JSON-serializable");
  }

  if (json === undefined) {
    throw new Error("Presence value must be JSON-serializable");
  }

  if (new TextEncoder().encode(json).byteLength > MAX_PRESENCE_VALUE_BYTES) {
    throw new Error(
      `Presence value must be ${MAX_PRESENCE_VALUE_BYTES} bytes or less`,
    );
  }
}

export function isPresenceRecord(
  value: unknown,
): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
