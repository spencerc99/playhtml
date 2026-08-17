// ABOUTME: Seeds a local v2 room from a production room in an NDJSON export.
// ABOUTME: Usage: `SUPABASE_URL=... SUPABASE_KEY=... bun partykit/scripts/seed-local-room.ts <export.ndjson> <source-room-name> <target-room-name>`

import { createInterface } from "node:readline";
import { createReadStream } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { convertDocumentToSnapshot } from "../convert";

async function main(): Promise<void> {
  const [exportPath, sourceRoom, targetRoom] = process.argv.slice(2);
  if (!exportPath || !sourceRoom || !targetRoom) {
    throw new Error(
      "Usage: bun partykit/scripts/seed-local-room.ts <export.ndjson> <source-room-name> <target-room-name>",
    );
  }
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_KEY;
  if (!supabaseUrl || !supabaseKey) {
    throw new Error("SUPABASE_URL and SUPABASE_KEY must be set.");
  }
  if (!supabaseUrl.includes("127.0.0.1") && !supabaseUrl.includes("localhost")) {
    throw new Error(
      "Refusing to seed a non-local Supabase instance. This script writes rows.",
    );
  }

  let document: string | null = null;
  const lines = createInterface({ input: createReadStream(exportPath) });
  for await (const line of lines) {
    if (!line) continue;
    const row = JSON.parse(line) as { name: string | null; document: string | null };
    if (row.name === sourceRoom) {
      document = row.document;
      break;
    }
  }
  if (document === null) {
    throw new Error(`Room ${JSON.stringify(sourceRoom)} not found in export.`);
  }

  const conversion = convertDocumentToSnapshot(document);
  if (!conversion.ok) {
    throw new Error(`Conversion failed: ${conversion.error.message}`);
  }

  const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false },
  });
  const { error } = await supabase.from("documents").upsert(
    {
      name: targetRoom,
      document,
      document_json: {
        snapshot: conversion.snapshot,
        sequence: 0,
        generation: 0,
      },
      protocol_version: 2,
    },
    { onConflict: "name" },
  );
  if (error) throw new Error(error.message);

  const elementCounts = Object.entries(conversion.snapshot.state)
    .map(([capability, elements]) => `${capability}=${Object.keys(elements).length}`)
    .join(" ");
  console.log(
    `Seeded ${targetRoom} from ${sourceRoom}: ${elementCounts || "empty"}`,
  );
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
