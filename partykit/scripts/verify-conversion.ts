// ABOUTME: Verifies v1 Yjs exports against their converted v2 room snapshots.
// ABOUTME: Streams NDJSON rows so large production exports stay memory-conscious.

import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { Buffer } from "node:buffer";
import * as Y from "yjs";
import { docToJson } from "../docUtils";
import { convertDocumentToSnapshot } from "../convert";

type ExportRow = {
  readonly name?: unknown;
  readonly document?: unknown;
};

type DecodeResult =
  | { readonly ok: true; readonly playData: Record<string, any> | null }
  | { readonly ok: false; readonly message: string };

type Difference = {
  readonly path: string;
  readonly expected: unknown;
  readonly actual: unknown;
};

type Mismatch = {
  readonly name: string;
  readonly differences: readonly Difference[];
};

type Failure = {
  readonly name: string;
  readonly message: string;
};

const MAX_DIFFERENCES = 5;
const MAX_RENDERED_VALUE_LENGTH = 240;

function usage(): string {
  return "Usage: bun partykit/scripts/verify-conversion.ts <ndjson-export-path>";
}

function formatRoomName(name: unknown, lineNumber: number): string {
  if (typeof name === "string") return name;
  if (name === null) return "<null>";
  return `<line ${lineNumber}>`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function extractV1PlayData(document: unknown): DecodeResult {
  if (typeof document !== "string") {
    return {
      ok: false,
      message: "The export row does not contain a base64 document string.",
    };
  }

  const doc = new Y.Doc();
  try {
    Y.applyUpdate(doc, new Uint8Array(Buffer.from(document, "base64")));
    return { ok: true, playData: docToJson(doc) };
  } catch (error: unknown) {
    return {
      ok: false,
      message: `Failed to decode the Yjs document: ${errorMessage(error)}`,
    };
  } finally {
    doc.destroy();
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function renderValue(value: unknown): string {
  let rendered: string;
  try {
    const serialized = JSON.stringify(value);
    rendered = serialized === undefined ? String(value) : serialized;
  } catch {
    rendered = String(value);
  }

  if (rendered.length <= MAX_RENDERED_VALUE_LENGTH) return rendered;
  return `${rendered.slice(0, MAX_RENDERED_VALUE_LENGTH - 3)}...`;
}

function collectDifferences(
  expected: unknown,
  actual: unknown,
  path: string,
  differences: Difference[],
): void {
  if (differences.length >= MAX_DIFFERENCES) return;

  if (Object.is(expected, actual)) return;

  if (Array.isArray(expected) || Array.isArray(actual)) {
    if (!Array.isArray(expected) || !Array.isArray(actual)) {
      differences.push({ path, expected, actual });
      return;
    }

    if (expected.length !== actual.length) {
      differences.push({
        path: `${path}.length`,
        expected: expected.length,
        actual: actual.length,
      });
    }

    const length = Math.min(expected.length, actual.length);
    for (let index = 0; index < length; index += 1) {
      collectDifferences(
        expected[index],
        actual[index],
        `${path}[${index}]`,
        differences,
      );
      if (differences.length >= MAX_DIFFERENCES) return;
    }
    return;
  }

  if (isRecord(expected) || isRecord(actual)) {
    if (!isRecord(expected) || !isRecord(actual)) {
      differences.push({ path, expected, actual });
      return;
    }

    const keys = new Set([...Object.keys(expected), ...Object.keys(actual)]);
    for (const key of [...keys].sort()) {
      if (!(key in expected) || !(key in actual)) {
        differences.push({
          path: `${path}.${key}`,
          expected: expected[key],
          actual: actual[key],
        });
      } else {
        collectDifferences(expected[key], actual[key], `${path}.${key}`, differences);
      }
      if (differences.length >= MAX_DIFFERENCES) return;
    }
    return;
  }

  differences.push({ path, expected, actual });
}

function compareValues(
  expected: unknown,
  actual: unknown,
): readonly Difference[] {
  const differences: Difference[] = [];
  collectDifferences(expected, actual, "$", differences);
  return differences;
}

function parseArgs(args: readonly string[]): string {
  if (args.length !== 1 || args[0] === "--help") {
    throw new Error(usage());
  }
  return args[0];
}

function printReport(report: {
  readonly totalRooms: number;
  readonly cleanRooms: number;
  readonly mismatches: readonly Mismatch[];
  readonly v1DecodeFailures: readonly Failure[];
  readonly conversionFailures: readonly Failure[];
}): void {
  console.log("Conversion verification report");
  console.log(`total rooms: ${report.totalRooms}`);
  console.log(`clean rooms: ${report.cleanRooms}`);
  console.log(`mismatched rooms: ${report.mismatches.length}`);
  console.log(`rooms that fail to decode in v1: ${report.v1DecodeFailures.length}`);
  console.log(`rooms that fail conversion: ${report.conversionFailures.length}`);

  if (report.mismatches.length > 0) {
    console.log("\nMismatched rooms:");
    for (const mismatch of report.mismatches) {
      const differences = mismatch.differences
        .map(
          (difference) =>
            `${difference.path}: expected ${renderValue(difference.expected)}, got ${renderValue(difference.actual)}`,
        )
        .join("; ");
      console.log(`- ${JSON.stringify(mismatch.name)}: ${differences}`);
    }
  }

  if (report.v1DecodeFailures.length > 0) {
    console.log("\nV1 decode failures:");
    for (const failure of report.v1DecodeFailures) {
      console.log(`- ${JSON.stringify(failure.name)}: ${failure.message}`);
    }
  }

  if (report.conversionFailures.length > 0) {
    console.log("\nConversion failures:");
    for (const failure of report.conversionFailures) {
      console.log(`- ${JSON.stringify(failure.name)}: ${failure.message}`);
    }
  }
}

async function main(): Promise<void> {
  let exportPath: string;
  try {
    exportPath = parseArgs(process.argv.slice(2));
  } catch (error: unknown) {
    console.error(errorMessage(error));
    process.exitCode = 1;
    return;
  }

  const input = createReadStream(exportPath, { encoding: "utf8" });
  const lines = createInterface({ input, crlfDelay: Infinity });
  const mismatches: Mismatch[] = [];
  const v1DecodeFailures: Failure[] = [];
  const conversionFailures: Failure[] = [];
  let totalRooms = 0;
  let cleanRooms = 0;

  try {
    for await (const line of lines) {
      if (line.trim().length === 0) continue;

      totalRooms += 1;
      let row: ExportRow;
      try {
        row = JSON.parse(line) as ExportRow;
      } catch (error: unknown) {
        const name = formatRoomName(undefined, totalRooms);
        const message = `Invalid NDJSON row: ${errorMessage(error)}`;
        v1DecodeFailures.push({ name, message });
        conversionFailures.push({ name, message });
        if (totalRooms % 5000 === 0) {
          console.log(`Progress: processed ${totalRooms} rooms`);
        }
        continue;
      }

      const name = formatRoomName(row.name, totalRooms);
      const v1 = extractV1PlayData(row.document);
      if (!v1.ok) {
        v1DecodeFailures.push({ name, message: v1.message });
      }

      const conversion = convertDocumentToSnapshot(
        typeof row.document === "string" ? row.document : "",
      );
      if (!conversion.ok) {
        conversionFailures.push({
          name,
          message: `${conversion.error.code}: ${conversion.error.message}`,
        });
      }

      if (v1.ok && conversion.ok) {
        const differences = compareValues(
          v1.playData ?? {},
          conversion.snapshot.state,
        );
        if (differences.length === 0) {
          cleanRooms += 1;
        } else {
          mismatches.push({ name, differences });
        }
      }

      if (totalRooms % 5000 === 0) {
        console.log(`Progress: processed ${totalRooms} rooms`);
      }
    }
  } catch (error: unknown) {
    console.error(`Failed to read export: ${errorMessage(error)}`);
    process.exitCode = 1;
    return;
  } finally {
    lines.close();
  }

  printReport({
    totalRooms,
    cleanRooms,
    mismatches,
    v1DecodeFailures,
    conversionFailures,
  });
  process.exitCode = mismatches.length > 0 ? 1 : 0;
}

void main();
