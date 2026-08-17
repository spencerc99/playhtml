// ABOUTME: Converts a persisted v1 Yjs document into a v2 room snapshot.
// ABOUTME: Assigns stable identities to every array while preserving plain room values.

import { Buffer } from "node:buffer";
import * as Y from "yjs";
import type {
  ArrayIdentity,
  JsonValue,
  ProtocolPath,
  RoomSnapshot,
  RoomState,
} from "@playhtml/common";
import { docToJson } from "./docUtils";

export type ConversionErrorCode = "empty-document" | "invalid-document";

export type ConversionError = {
  readonly code: ConversionErrorCode;
  readonly message: string;
};

export type ConversionSuccess = {
  readonly ok: true;
  readonly snapshot: RoomSnapshot;
};

export type ConversionFailure = {
  readonly ok: false;
  readonly error: ConversionError;
};

export type ConversionResult = ConversionSuccess | ConversionFailure;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isJsonValue(value: unknown): value is JsonValue {
  if (value === null) return true;

  if (typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);

  if (Array.isArray(value)) {
    return value.every((item) => isJsonValue(item));
  }

  if (typeof value !== "object") return false;

  return Object.values(value).every((item) => isJsonValue(item));
}

function collectArrayIdentities(
  value: JsonValue,
  capability: string,
  elementId: string,
  path: ProtocolPath,
  arrays: ArrayIdentity[],
): void {
  if (Array.isArray(value)) {
    const itemIds = value.map(() => crypto.randomUUID());
    arrays.push({ capability, elementId, path, itemIds });

    value.forEach((item, index) => {
      collectArrayIdentities(
        item,
        capability,
        elementId,
        [...path, { itemId: itemIds[index] }],
        arrays,
      );
    });
    return;
  }

  if (value !== null && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      collectArrayIdentities(child, capability, elementId, [...path, key], arrays);
    }
  }
}

function createSnapshot(state: RoomState): RoomSnapshot {
  const arrays: ArrayIdentity[] = [];

  for (const [capability, elements] of Object.entries(state)) {
    for (const [elementId, value] of Object.entries(elements)) {
      collectArrayIdentities(value, capability, elementId, [], arrays);
    }
  }

  return {
    state,
    arrays,
    lastMutationIds: {},
  };
}

/**
 * Decode and convert one persisted v1 Yjs document without throwing on bad input.
 */
export function convertDocumentToSnapshot(
  base64YjsDoc: string,
): ConversionResult {
  if (typeof base64YjsDoc !== "string" || base64YjsDoc.length === 0) {
    return {
      ok: false,
      error: {
        code: "empty-document",
        message: "The Yjs document is empty.",
      },
    };
  }

  const doc = new Y.Doc();

  try {
    const update = new Uint8Array(Buffer.from(base64YjsDoc, "base64"));
    if (update.length === 0) {
      return {
        ok: false,
        error: {
          code: "empty-document",
          message: "The Yjs document contains no update data.",
        },
      };
    }

    Y.applyUpdate(doc, update);
    const playData = docToJson(doc);
    if (playData === null) {
      // A decodable document with no play data is an empty room, not an
      // error: v1 serves nothing for it, so an empty snapshot loses nothing.
      // 1,925 of 83,153 production rooms are in this state (2026-08-17 sweep).
      return {
        ok: true,
        snapshot: { state: {}, arrays: [], lastMutationIds: {} },
      };
    }

    const state = playData as RoomState;
    for (const elements of Object.values(state)) {
      if (
        elements === null ||
        typeof elements !== "object" ||
        Array.isArray(elements)
      ) {
        return {
          ok: false,
          error: {
            code: "invalid-document",
            message: "The PlayHTML data does not match the room state shape.",
          },
        };
      }
      for (const value of Object.values(elements)) {
        if (!isJsonValue(value)) {
          return {
            ok: false,
            error: {
              code: "invalid-document",
              message: "The PlayHTML data contains a non-JSON value.",
            },
          };
        }
      }
    }

    return { ok: true, snapshot: createSnapshot(state) };
  } catch (error: unknown) {
    return {
      ok: false,
      error: {
        code: "invalid-document",
        message: `Failed to decode the Yjs document: ${errorMessage(error)}`,
      },
    };
  } finally {
    doc.destroy();
  }
}
