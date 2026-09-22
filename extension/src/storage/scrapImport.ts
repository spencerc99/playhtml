// ABOUTME: Inverts the flattened scraps export back into the element events a collector writes.
// ABOUTME: Validates every record up front so a malformed file never lands a partial import.

import type { CollectionEvent } from "@playhtml/extension-types";
import type { ScrapEventData } from "../collectors/types";

/** A scraps export file: the same records `GET_SCRAPS` returns. */
export interface ScrapExport {
  scraps: unknown[];
}

/** Raised when a record in the file does not describe a scrap we can store. */
export class ScrapImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScrapImportError";
  }
}

/**
 * Reconstructed capture payload. An export carries what a scrap needs to be
 * rendered and identified, not the collector's capture-time measurements, so
 * `ImageScrapData`'s display size is absent here rather than invented.
 */
type ImportedScrapData =
  | (Omit<Extract<ScrapEventData, { kind: "image" }>, "displayWidth" | "displayHeight">)
  | Extract<ScrapEventData, { kind: "button" | "svg-icon" | "cursor" }>;

export interface ImportedScrapEvent extends CollectionEvent {
  type: "element";
  data: ImportedScrapData;
}


function describe(index: number, problem: string): ScrapImportError {
  return new ScrapImportError(`scraps export record ${index} ${problem}`);
}

function readObject(value: unknown, index: number): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw describe(index, "is not an object");
  }
  return value as Record<string, unknown>;
}

/** A field a scrap cannot be identified or rendered without. */
function readString(
  record: Record<string, unknown>,
  field: string,
  index: number,
): string {
  const value = record[field];
  if (typeof value !== "string" || value.length === 0) {
    throw describe(index, `is missing a ${field} string`);
  }
  return value;
}

/**
 * Text a source page can legitimately leave blank, such as an untitled page or
 * an icon-only button. The field must be present and a string; empty is a real
 * value the collector records, not a missing one.
 */
function readText(
  record: Record<string, unknown>,
  field: string,
  index: number,
): string {
  const value = record[field];
  if (typeof value !== "string") {
    throw describe(index, `has a ${field} that is not a string`);
  }
  return value;
}

function readOptionalString(
  record: Record<string, unknown>,
  field: string,
  index: number,
): string | undefined {
  const value = record[field];
  if (value === undefined) return undefined;
  if (typeof value !== "string") {
    throw describe(index, `has a ${field} that is not a string`);
  }
  return value;
}

function readNumber(
  record: Record<string, unknown>,
  field: string,
  index: number,
): number {
  const value = record[field];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw describe(index, `is missing a finite ${field}`);
  }
  return value;
}

function readOptionalNumber(
  record: Record<string, unknown>,
  field: string,
  index: number,
): number | undefined {
  const value = record[field];
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw describe(index, `has a ${field} that is not a finite number`);
  }
  return value;
}

function readStyles(
  record: Record<string, unknown>,
  index: number,
): Record<string, string> {
  const value = record.styles;
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw describe(index, "is missing its button styles");
  }
  const styles: Record<string, string> = {};
  for (const [property, declared] of Object.entries(value)) {
    if (typeof declared !== "string") {
      throw describe(index, `has a non-string style value for ${property}`);
    }
    styles[property] = declared;
  }
  return styles;
}

function readScrapData(
  record: Record<string, unknown>,
  index: number,
): ImportedScrapData {
  const pageTitle = readText(record, "pageTitle", index);
  const faviconUrl = readOptionalString(record, "faviconUrl", index);
  const shared = {
    pageTitle,
    ...(faviconUrl !== undefined ? { faviconUrl } : {}),
  };

  switch (record.kind) {
    case "image": {
      const contentHash = readOptionalString(record, "contentHash", index);
      const alt = readOptionalString(record, "alt", index);
      return {
        ...shared,
        kind: "image",
        src: readString(record, "src", index),
        ...(contentHash !== undefined ? { contentHash } : {}),
        ...(alt !== undefined ? { alt } : {}),
        naturalWidth: readNumber(record, "naturalWidth", index),
        naturalHeight: readNumber(record, "naturalHeight", index),
      };
    }
    case "button": {
      const innerSvg = readOptionalString(record, "innerSvg", index);
      return {
        ...shared,
        kind: "button",
        text: readText(record, "text", index),
        styles: readStyles(record, index),
        ...(innerSvg !== undefined ? { innerSvg } : {}),
      };
    }
    case "svg-icon":
      return {
        ...shared,
        kind: "svg-icon",
        markup: readString(record, "markup", index),
        width: readNumber(record, "width", index),
        height: readNumber(record, "height", index),
      };
    case "cursor": {
      const hotspotX = readOptionalNumber(record, "hotspotX", index);
      const hotspotY = readOptionalNumber(record, "hotspotY", index);
      return {
        ...shared,
        kind: "cursor",
        url: readString(record, "url", index),
        ...(hotspotX !== undefined ? { hotspotX } : {}),
        ...(hotspotY !== undefined ? { hotspotY } : {}),
      };
    }
    default:
      throw describe(
        index,
        `has an unknown kind ${JSON.stringify(record.kind)}`,
      );
  }
}

/**
 * The context an export cannot carry. An export records what a scrap is and
 * where it came from, not who is holding it or the viewport it was captured
 * in, so the importing browser supplies those.
 */
export interface ScrapImportIdentity {
  pid: string;
  sid: string;
  timeZone: string;
  viewportWidth: number;
  viewportHeight: number;
}

/**
 * Validates the whole file before producing anything, so the caller either
 * writes every record or writes none. Each event is shaped like the one the
 * scrap collector emits, so the store derives the same canonical key,
 * encounter day, and grouping it would for a freshly collected scrap.
 *
 * `normalizedUrl` is left off so the store derives it from `meta.url` with the
 * normalizer the collector path uses, indexing the event the same way.
 */
export function readScrapExport(
  file: unknown,
  identity: ScrapImportIdentity,
): ImportedScrapEvent[] {
  if (typeof file !== "object" || file === null || Array.isArray(file)) {
    throw new ScrapImportError("scraps export is not an object");
  }
  const scraps = (file as { scraps?: unknown }).scraps;
  if (!Array.isArray(scraps)) {
    throw new ScrapImportError("scraps export is missing its scraps list");
  }

  return scraps.map((entry, index) => {
    const record = readObject(entry, index);
    return {
      id: readString(record, "id", index),
      type: "element",
      ts: readNumber(record, "ts", index),
      data: readScrapData(record, index),
      meta: {
        pid: identity.pid,
        sid: identity.sid,
        url: readString(record, "pageUrl", index),
        vw: identity.viewportWidth,
        vh: identity.viewportHeight,
        tz: identity.timeZone,
      },
      domain: readString(record, "domain", index),
    };
  });
}
