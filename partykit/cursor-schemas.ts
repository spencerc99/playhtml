import { encode, decode } from "@msgpack/msgpack";
import z from "zod";
import type { CursorPartyMessage, CursorClientMessage } from "@playhtml/common";

// Zod schemas for server-side validation
export const cursorSchema = z.object({
  x: z.number(),
  y: z.number(),
  pointer: z.union([z.literal("mouse"), z.literal("touch"), z.string()]),
});

export const playerIdentitySchema = z.object({
  publicKey: z.string(),
  name: z.string().optional(),
  playerStyle: z.object({
    colorPalette: z.array(z.string()),
    cursorStyle: z.string().optional(),
  }),
});

export const cursorPresenceSchema = z.object({
  cursor: cursorSchema.optional().nullable(),
  playerIdentity: playerIdentitySchema.optional(),
  lastSeen: z.number().optional(),
});

export const cursorMetadataSchema = z.object({
  country: z.string().nullable(),
  connectionId: z.string(),
});

export const cursorUserSchema = z.object({
  presence: cursorPresenceSchema,
  metadata: cursorMetadataSchema,
});

export const cursorPartyMessageSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("cursor-sync"),
    users: z.record(cursorUserSchema),
  }),
  z.object({
    type: z.literal("cursor-changes"),
    add: z.record(cursorUserSchema).optional(),
    presence: z.record(cursorPresenceSchema).optional(),
    remove: z.array(z.string()).optional(),
  }),
  z.object({
    type: z.literal("proximity-entered"),
    connectionId: z.string(),
    otherConnectionId: z.string(),
    playerIdentity: playerIdentitySchema.optional(),
  }),
  z.object({
    type: z.literal("proximity-left"),
    connectionId: z.string(),
    otherConnectionId: z.string(),
  }),
]);

export const cursorClientMessageSchema = z.union([
  z.object({
    type: z.literal("cursor-update"),
    presence: cursorPresenceSchema,
  }),
  z.object({
    type: z.literal("cursor-request-sync"),
  }),
]);

// Server configuration
export const BROADCAST_INTERVAL = 1000 / 60; // 60fps
export const CURSOR_CLEANUP_INTERVAL = 30000; // 30 seconds
export const CURSOR_TIMEOUT = 10000; // 10 seconds

// Message encoding/decoding utilities
export function decodeCursorMessage(message: string | ArrayBufferLike) {
  return typeof message === "string" ? JSON.parse(message) : decode(message);
}

export function encodeCursorPartyMessage(
  data: CursorPartyMessage
): ArrayBufferLike {
  return encode(cursorPartyMessageSchema.parse(data));
}

export function encodeCursorClientMessage(
  data: CursorClientMessage
): ArrayBufferLike {
  return encode(cursorClientMessageSchema.parse(data));
}
