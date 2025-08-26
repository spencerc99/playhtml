// Client-side message encoding utilities
import { encode, decode } from "@msgpack/msgpack";
import type { CursorClientMessage, CursorPartyMessage } from "@playhtml/common";

export function encodeCursorClientMessage(message: CursorClientMessage): Uint8Array {
  return encode(message);
}

export function decodeCursorPartyMessage(data: ArrayBuffer | Uint8Array | string): CursorPartyMessage {
  return typeof data === "string" ? JSON.parse(data) : decode(data) as CursorPartyMessage;
}