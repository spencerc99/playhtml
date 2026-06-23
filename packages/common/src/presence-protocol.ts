// ABOUTME: Defines generic realtime presence messages shared by clients and servers.
// ABOUTME: Validates ephemeral channel updates before they enter PlayHTML rooms.

import type { Cursor, CursorZonePosition, PlayerIdentity } from "./cursor-types";

export const MAX_PRESENCE_VALUE_BYTES = 4096;

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
  if (!isRecord(value)) {
    throw new Error("Presence message must be an object");
  }

  switch (value.type) {
    case "presence-join":
      validateOptionalString(value.page, "page");
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

function validatePresenceValue(channel: unknown, value: unknown): void {
  if (value === undefined) {
    throw new Error("Presence value must not be undefined");
  }

  assertJsonSize(value);

  if (channel === "cursor") {
    validateCursorPresenceValue(value);
  }
}

function validateCursorPresenceValue(value: unknown): void {
  if (!isRecord(value)) {
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

  validateOptionalString(value.page, "page");

  if (value.at !== undefined && !Number.isFinite(value.at)) {
    throw new Error("cursor at must be a finite number");
  }
}

function validateCursor(value: unknown): void {
  if (!isRecord(value)) {
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
  if (!isRecord(value)) {
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
  if (value.length > 128) {
    throw new Error("Presence channel must be 128 characters or less");
  }
  if (/[\u0000-\u001f\u007f]/.test(value)) {
    throw new Error("Presence channel must not contain control characters");
  }
}

function validateOptionalString(value: unknown, name: string): void {
  if (value !== undefined && typeof value !== "string") {
    throw new Error(`${name} must be a string`);
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
