// ABOUTME: Returns one room from the v2 protocol to v1, keeping every write made on v2.
// ABOUTME: Usage: `SUPABASE_URL=... SUPABASE_KEY=... bun partykit/scripts/rollback-room.ts <room-name> [--apply]`; without --apply it only reports what it would write.

import { isDeepStrictEqual } from "node:util";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import type { RoomSnapshot } from "@playhtml/common";
import {
  convertDocumentToSnapshot,
  convertSnapshotToDocument,
} from "../convert";

export type RollbackRoomOptions = {
  room: string;
  apply: boolean;
  supabaseUrl?: string;
  supabaseKey?: string;
  now?: () => number;
};

export type RollbackRoomSummary = {
  room: string;
  applied: boolean;
  sequence: number;
  resetEpoch: number;
  elementCounts: string;
  documentBytes: number;
};

type PersistedV2Document = {
  snapshot: RoomSnapshot;
  sequence: number;
};

function readPersistedV2Document(value: unknown): PersistedV2Document {
  if (value === null || typeof value !== "object") {
    throw new Error("document_json is missing or not an object.");
  }
  const { snapshot, sequence } = value as Record<string, unknown>;
  if (!Number.isSafeInteger(sequence) || (sequence as number) < 0) {
    throw new Error("document_json.sequence is missing or invalid.");
  }
  if (
    snapshot === null ||
    typeof snapshot !== "object" ||
    typeof (snapshot as RoomSnapshot).state !== "object" ||
    (snapshot as RoomSnapshot).state === null
  ) {
    throw new Error("document_json.snapshot.state is missing.");
  }
  return { snapshot: snapshot as RoomSnapshot, sequence: sequence as number };
}

/**
 * Build the v1 document for a v2 snapshot and prove it decodes back to the
 * same room state before anything is written.
 */
export function buildRollbackDocument(
  snapshot: RoomSnapshot,
  resetEpoch: number,
): string {
  const document = convertSnapshotToDocument(snapshot, resetEpoch);
  const decoded = convertDocumentToSnapshot(document);
  if (!decoded.ok) {
    throw new Error(
      `The rebuilt v1 document does not decode: ${decoded.error.message}`,
    );
  }
  // v1 drops capabilities that hold no elements, so compare without them.
  const expectedState = Object.fromEntries(
    Object.entries(snapshot.state).filter(
      ([, elements]) => Object.keys(elements).length > 0,
    ),
  );
  const decodedState = Object.fromEntries(
    Object.entries(decoded.snapshot.state).filter(
      ([, elements]) => Object.keys(elements).length > 0,
    ),
  );
  if (!isDeepStrictEqual(decodedState, expectedState)) {
    throw new Error(
      "The rebuilt v1 document does not hold the same room state as the v2 snapshot.",
    );
  }
  return document;
}

export async function rollbackRoom({
  room,
  apply,
  supabaseUrl = process.env.SUPABASE_URL,
  supabaseKey = process.env.SUPABASE_KEY,
  now = Date.now,
}: RollbackRoomOptions): Promise<RollbackRoomSummary> {
  if (!supabaseUrl || !supabaseKey) {
    throw new Error("SUPABASE_URL and SUPABASE_KEY must be set.");
  }
  const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false },
  });

  const { data, error } = await supabase
    .from("documents")
    .select("document_json, protocol_version")
    .eq("name", room)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error(`Room ${JSON.stringify(room)} not found.`);
  if (data.protocol_version !== 2) {
    throw new Error(
      `Room ${JSON.stringify(room)} is on protocol version ${data.protocol_version}, not 2. Nothing to roll back.`,
    );
  }

  const { snapshot, sequence } = readPersistedV2Document(data.document_json);
  const resetEpoch = now();
  const document = buildRollbackDocument(snapshot, resetEpoch);

  if (apply) {
    // The sequence filter makes this a no-op if the v2 room saved again after
    // the read above, so a write made in between is never dropped.
    const { data: updated, error: updateError } = await supabase
      .from("documents")
      .update({ document, protocol_version: 1 })
      .eq("name", room)
      .eq("protocol_version", 2)
      .eq("document_json->>sequence", String(sequence))
      .select("name");
    if (updateError) throw new Error(updateError.message);
    if (!updated || updated.length !== 1) {
      throw new Error(
        `Room ${JSON.stringify(room)} changed while rolling back (expected sequence ${sequence}). Nothing was written. Stop v2 traffic to the room and run again.`,
      );
    }
  }

  const elementCounts = Object.entries(snapshot.state)
    .map(
      ([capability, elements]) =>
        `${capability}=${Object.keys(elements).length}`,
    )
    .join(" ");

  return {
    room,
    applied: apply,
    sequence,
    resetEpoch,
    elementCounts: elementCounts || "empty",
    documentBytes: document.length,
  };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const positional = args.filter((argument) => !argument.startsWith("-"));
  const unknown = args.filter(
    (argument) => argument.startsWith("-") && argument !== "--apply",
  );
  if (positional.length !== 1 || unknown.length > 0) {
    throw new Error(
      "Usage: bun partykit/scripts/rollback-room.ts <room-name> [--apply]",
    );
  }

  const summary = await rollbackRoom({ room: positional[0], apply });
  console.log(
    `${summary.applied ? "Rolled back" : "Dry run for"} ${JSON.stringify(summary.room)}: ` +
      `v2 sequence=${summary.sequence}, ${summary.elementCounts}, ` +
      `v1 document=${summary.documentBytes} bytes, resetEpoch=${summary.resetEpoch}`,
  );
  if (summary.applied) {
    console.log(
      "The room's v2 server must have no connections, or its next save stamps the room as v2 again. " +
        "A running v1 server for this room stays read-only until it reloads the row.",
    );
  } else {
    console.log("Nothing was written. Pass --apply to write.");
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
