// ABOUTME: Writes one collage to a self-contained file and reads such a file back.
// ABOUTME: Carries a collage between browsers, since collages live only in local IndexedDB.

import {
  parseCollageRecord,
  withFreshIds,
  type CollageRecord,
} from "./collageRecord";
import { upgradeToCurrentShape } from "./upgradeCollageRecord";

export const COLLAGE_FILE_FORMAT = "wwo-collage";
export const COLLAGE_FILE_VERSION = 1;

/** The baked picture as file text: its bytes in base64 and their media type. */
export type EncodedPreview =
  | { drawn: true; image: { mediaType: string; base64: string } }
  | { drawn: false; reason: string };

export interface CollageFileEnvelope {
  format: typeof COLLAGE_FILE_FORMAT;
  version: typeof COLLAGE_FILE_VERSION;
  exportedAt: number;
  collage: Omit<CollageRecord, "preview"> & { preview: EncodedPreview };
}

/** A file that cannot be opened as a collage, with the reason it names. */
export class CollageFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CollageFileError";
  }
}

/** What a saved collage's file is called on disk. */
export function collageFileName(title: string): string {
  return `${title.trim() || "untitled collage"}.collage.json`;
}

function bytesToBase64(bytes: Uint8Array): string {
  // Built in slices, because spreading a multi-megabyte picture into one
  // String.fromCharCode call overflows the argument limit.
  const SLICE = 0x8000;
  let binary = "";
  for (let at = 0; at < bytes.length; at += SLICE) {
    binary += String.fromCharCode(...bytes.subarray(at, at + SLICE));
  }
  return btoa(binary);
}

function base64ToBytes(base64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let at = 0; at < binary.length; at += 1) {
    bytes[at] = binary.charCodeAt(at);
  }
  return bytes;
}

/** The whole file for one collage, as the text written to disk. */
export async function encodeCollageFile(
  record: CollageRecord,
  now: number = Date.now(),
): Promise<string> {
  const preview: EncodedPreview = record.preview.drawn
    ? {
        drawn: true,
        image: {
          mediaType: record.preview.image.type,
          base64: bytesToBase64(
            new Uint8Array(await record.preview.image.arrayBuffer()),
          ),
        },
      }
    : { drawn: false, reason: record.preview.reason };
  const envelope: CollageFileEnvelope = {
    format: COLLAGE_FILE_FORMAT,
    version: COLLAGE_FILE_VERSION,
    exportedAt: now,
    collage: { ...record, preview },
  };
  return JSON.stringify(envelope);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Turns the file's written-out picture back into a Blob, so the collage it
 * belongs to is in the shape the store keeps.
 */
function decodePreview(value: unknown): CollageRecord["preview"] {
  if (!isPlainObject(value)) {
    throw new CollageFileError("the collage inside has no preview");
  }
  if (value.drawn === false) {
    if (typeof value.reason !== "string") {
      throw new CollageFileError(
        "the collage inside has an undrawn preview that does not say why",
      );
    }
    return { drawn: false, reason: value.reason };
  }
  if (value.drawn !== true || !isPlainObject(value.image)) {
    throw new CollageFileError("the collage inside has no preview");
  }
  const { mediaType, base64 } = value.image;
  if (typeof mediaType !== "string" || !mediaType.startsWith("image/")) {
    throw new CollageFileError(
      `the collage's preview has an unknown media type: ${String(mediaType)}`,
    );
  }
  if (typeof base64 !== "string" || base64.length === 0) {
    throw new CollageFileError("the collage's preview carries no picture");
  }
  let bytes: Uint8Array<ArrayBuffer>;
  try {
    bytes = base64ToBytes(base64);
  } catch {
    throw new CollageFileError("the collage's preview is not valid base64");
  }
  return { drawn: true, image: new Blob([bytes], { type: mediaType }) };
}

/**
 * Reads a collage file back into a record, exactly as it was saved. Anything
 * wrong with the file rejects the whole of it: a file that is not a collage
 * file, one written by a version this build does not know, or a collage that
 * cannot be read even after the upgrades the store runs on its own rows.
 */
export function readCollageFile(text: string): CollageRecord {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new CollageFileError("it is not a JSON file");
  }
  if (!isPlainObject(parsed) || parsed.format !== COLLAGE_FILE_FORMAT) {
    throw new CollageFileError("it is not a collage file");
  }
  if (parsed.version !== COLLAGE_FILE_VERSION) {
    throw new CollageFileError(
      `it is a version ${String(parsed.version)} collage file, and this build reads version ${COLLAGE_FILE_VERSION}`,
    );
  }
  if (!isPlainObject(parsed.collage)) {
    throw new CollageFileError("it holds no collage");
  }
  const collage = {
    ...parsed.collage,
    preview: decodePreview(parsed.collage.preview),
  };
  try {
    return parseCollageRecord(upgradeToCurrentShape(collage));
  } catch (error) {
    throw new CollageFileError(
      `the collage inside could not be read: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * The collage a file brings in, as a record of its own: fresh ids so opening
 * the same file twice gives two collages, with the title and the dates it was
 * made and last changed kept from the file.
 */
export function importCollageFile(text: string): CollageRecord {
  return withFreshIds(readCollageFile(text));
}
