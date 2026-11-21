// ABOUTME: Seeds the checked-in production-room fixture into local v2 storage.
// ABOUTME: Reuses the single-room converter and refuses non-local Supabase targets.

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { assertLocalSupabaseUrl, seedLocalRoom } from "./seed-local-room";

type ProductionRoom = {
  prodRoom: string;
  localRoom: string;
  pagePath: string;
  notes: string;
};

function usage(): string {
  return "Usage: SUPABASE_URL=... SUPABASE_KEY=... bun partykit/scripts/seed-prod-rooms.ts <export.ndjson>";
}

function isProductionRoom(value: unknown): value is ProductionRoom {
  if (value === null || typeof value !== "object") return false;
  const room = value as Record<string, unknown>;
  return (
    typeof room.prodRoom === "string" &&
    typeof room.localRoom === "string" &&
    typeof room.pagePath === "string" &&
    typeof room.notes === "string"
  );
}

async function readProductionRooms(): Promise<ProductionRoom[]> {
  const path = fileURLToPath(
    new URL("../../e2e/v2/prod-rooms.json", import.meta.url),
  );
  const parsed: unknown = JSON.parse(await readFile(path, "utf8"));
  if (!Array.isArray(parsed) || !parsed.every(isProductionRoom)) {
    throw new Error(`Invalid production-room fixture: ${path}`);
  }
  return parsed;
}

async function main(): Promise<void> {
  const [exportPath] = process.argv.slice(2);
  if (!exportPath) throw new Error(usage());

  const supabaseUrl = process.env.SUPABASE_URL;
  if (!supabaseUrl || !process.env.SUPABASE_KEY) {
    throw new Error("SUPABASE_URL and SUPABASE_KEY must be set.");
  }
  assertLocalSupabaseUrl(supabaseUrl);

  const rooms = await readProductionRooms();
  for (const room of rooms) {
    const summary = await seedLocalRoom({
      exportPath,
      sourceRoom: room.prodRoom,
      targetRoom: room.localRoom,
      supabaseUrl,
    });
    console.log(
      `[${room.pagePath}] Seeded ${summary.targetRoom} from ${summary.sourceRoom}: ${summary.elementCounts}`,
    );
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
