// ABOUTME: Streams selected PostgreSQL COPY sections from a Zstandard-compressed Supabase export.
// ABOUTME: Decodes navigation events and page metadata without writing the uncompressed SQL dump.

import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

import type { CollectionEvent } from "@playhtml/extension-types";

export interface ExportPageMetadata {
  pageRef: string;
  canonicalUrl: string;
  title: string;
  faviconUrl: string;
  validFrom: number;
  validTo: number | null;
}

export interface ExportScanSummary {
  collectionRows: number;
  navigationRows: number;
  metadataRows: number;
  parseFailures: number;
  failureExamples: string[];
}

export interface ExportScanHandlers {
  onNavigation(event: CollectionEvent): void;
  onMetadata(metadata: ExportPageMetadata): void;
  onProgress?(summary: ExportScanSummary): void;
}

const COLLECTION_HEADER = 'COPY "public"."collection_events" ';
const METADATA_HEADER = 'COPY "public"."page_metadata_history" ';

export function decodeCopyField(field: string): string | null {
  if (field === "\\N") return null;
  let result = "";
  for (let index = 0; index < field.length; index++) {
    const character = field[index];
    if (character !== "\\" || index === field.length - 1) {
      result += character;
      continue;
    }

    const escaped = field[++index];
    const simpleEscapes: Record<string, string> = {
      b: "\b",
      f: "\f",
      n: "\n",
      r: "\r",
      t: "\t",
      v: "\v",
      "\\": "\\",
    };
    if (escaped in simpleEscapes) {
      result += simpleEscapes[escaped];
      continue;
    }

    if (escaped === "x") {
      const hexadecimal = field.slice(index + 1, index + 3);
      if (/^[0-9a-f]{1,2}$/i.test(hexadecimal)) {
        result += String.fromCharCode(Number.parseInt(hexadecimal, 16));
        index += hexadecimal.length;
        continue;
      }
    }

    if (/^[0-7]$/.test(escaped)) {
      const octal = `${escaped}${field.slice(index + 1, index + 3)}`.match(/^[0-7]{1,3}/)?.[0] ?? escaped;
      result += String.fromCharCode(Number.parseInt(octal, 8));
      index += octal.length - 1;
      continue;
    }

    result += escaped;
  }
  return result;
}

function nonNullField(fields: string[], index: number, name: string): string {
  const value = decodeCopyField(fields[index] ?? "\\N");
  if (value === null) throw new Error(`COPY row is missing ${name}`);
  return value;
}

function requiredField(fields: string[], index: number, name: string): string {
  const value = nonNullField(fields, index, name);
  if (value === "") throw new Error(`COPY row has an empty ${name}`);
  return value;
}

export function parseNavigationRow(line: string): CollectionEvent | null {
  const fields = line.split("\t");
  if (fields.length !== 10) throw new Error(`collection_events COPY row has ${fields.length} fields`);
  if (fields[1] !== "navigation") return null;
  const timestamp = Date.parse(requiredField(fields, 2, "ts"));
  if (!Number.isFinite(timestamp)) throw new Error("collection_events COPY row has an invalid ts");
  const data = JSON.parse(requiredField(fields, 9, "data")) as unknown;
  const viewportWidth = decodeCopyField(fields[6]);
  const viewportHeight = decodeCopyField(fields[7]);

  return {
    id: requiredField(fields, 0, "id"),
    type: "navigation",
    ts: timestamp,
    data,
    meta: {
      pid: requiredField(fields, 3, "participant_id"),
      sid: requiredField(fields, 4, "session_id"),
      url: requiredField(fields, 5, "url"),
      vw: viewportWidth === null ? 0 : Number(viewportWidth),
      vh: viewportHeight === null ? 0 : Number(viewportHeight),
      tz: decodeCopyField(fields[8]) ?? "",
    },
  };
}

export function parseMetadataRow(line: string): ExportPageMetadata {
  const fields = line.split("\t");
  if (fields.length !== 9) throw new Error(`page_metadata_history COPY row has ${fields.length} fields`);
  const validFrom = Date.parse(requiredField(fields, 6, "valid_from_ts"));
  const rawValidTo = decodeCopyField(fields[7]);
  const validTo = rawValidTo === null ? null : Date.parse(rawValidTo);
  if (!Number.isFinite(validFrom) || validTo !== null && !Number.isFinite(validTo)) {
    throw new Error("page_metadata_history COPY row has an invalid validity timestamp");
  }
  return {
    pageRef: requiredField(fields, 1, "page_ref"),
    canonicalUrl: requiredField(fields, 2, "canonical_url"),
    title: nonNullField(fields, 3, "title"),
    faviconUrl: nonNullField(fields, 4, "favicon_url"),
    validFrom,
    validTo,
  };
}

export function joinCopyLine(pendingLine: string | null, line: string, continuation: string): string {
  return pendingLine === null ? line : `${pendingLine}${continuation}${line}`;
}

export function appendCopyLine(pendingLine: string | null, line: string, expectedFields: number, continuation = "\n"): string | null {
  const record = joinCopyLine(pendingLine, line, continuation);
  return record.split("\t").length < expectedFields ? record : null;
}

function isIncompleteJson(error: unknown): boolean {
  return error instanceof SyntaxError && /unterminated string|unexpected end of json input/i.test(error.message);
}

export async function scanProductionExport(archivePath: string, handlers: ExportScanHandlers): Promise<ExportScanSummary> {
  const process = spawn("zstd", ["--quiet", "--decompress", "--stdout", archivePath], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  const exitPromise = new Promise<number | null>((resolve) => process.once("close", resolve));
  let stderr = "";
  process.stderr.setEncoding("utf8");
  process.stderr.on("data", (chunk: string) => {
    stderr += chunk;
  });
  const lines = createInterface({ input: process.stdout, crlfDelay: Infinity });
  const summary: ExportScanSummary = { collectionRows: 0, navigationRows: 0, metadataRows: 0, parseFailures: 0, failureExamples: [] };
  let section: "collection" | "metadata" | null = null;
  let pendingLine: string | null = null;
  let lastProgressAt = Date.now();

  for await (const line of lines) {
    if (line.startsWith(COLLECTION_HEADER)) {
      section = "collection";
      continue;
    }
    if (line.startsWith(METADATA_HEADER)) {
      section = "metadata";
      continue;
    }
    if (section !== null && line === "\\." && pendingLine === null) {
      section = null;
      continue;
    }
    if (section === null) continue;

    const expectedFields = section === "collection" ? 10 : 9;
    const continuation = section === "collection" ? "\\\\n" : "\\n";
    const record = joinCopyLine(pendingLine, line, continuation);
    if (appendCopyLine(pendingLine, line, expectedFields, continuation) !== null) {
      pendingLine = record;
      continue;
    }
    pendingLine = null;

    try {
      if (section === "collection") {
        summary.collectionRows++;
        const event = parseNavigationRow(record);
        if (event) {
          summary.navigationRows++;
          handlers.onNavigation(event);
        }
      } else {
        summary.metadataRows++;
        handlers.onMetadata(parseMetadataRow(record));
      }
    } catch (error) {
      if (section === "collection" && isIncompleteJson(error)) {
        summary.collectionRows--;
        pendingLine = record;
        continue;
      }
      summary.parseFailures++;
      if (summary.failureExamples.length < 5) {
        summary.failureExamples.push(error instanceof Error ? error.message : String(error));
      }
    }

    if (handlers.onProgress && Date.now() - lastProgressAt >= 5_000) {
      handlers.onProgress({ ...summary });
      lastProgressAt = Date.now();
    }
  }

  if (pendingLine !== null) {
    summary.parseFailures++;
    if (summary.failureExamples.length < 5) summary.failureExamples.push("COPY section ended with an incomplete row");
  }

  const exitCode = await exitPromise;
  if (exitCode !== 0) throw new Error(`zstd exited with ${exitCode}: ${stderr.trim()}`);
  return summary;
}
