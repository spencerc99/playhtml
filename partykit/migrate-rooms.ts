/**
 * Room ID Migration Script
 *
 * This script:
 * 1. Audits existing rooms in the database
 * 2. Identifies invalid room IDs (undefined, filesystem paths, etc.)
 * 3. Creates redirects for www consolidation
 * 4. Optionally merges duplicate rooms
 *
 * Usage:
 *   bun run partykit/migrate-rooms.ts [--dry-run] [--merge-duplicates]
 */

import { supabase } from "./db";
import {
  createRoomId,
  normalizeHost,
  normalizePath,
  isInvalidRoomId,
} from "@playhtml/common";

interface RoomRecord {
  name: string;
  document: string;
  created_at?: string;
  updated_at?: string;
}

interface MigrationResult {
  totalRooms: number;
  invalidRooms: RoomRecord[];
  wwwDuplicates: Array<{
    wwwRoom: RoomRecord;
    nonWwwRoom: RoomRecord | null;
  }>;
  redirectsCreated: number;
  roomsMerged: number;
  errors: Array<{ room: string; error: string }>;
}

async function getAllRooms(): Promise<RoomRecord[]> {
  const { data, error } = await supabase
    .from("documents")
    .select("name, document, created_at, updated_at")
    .order("created_at", { ascending: true });

  if (error) {
    throw new Error(`Failed to fetch rooms: ${error.message}`);
  }

  return data || [];
}

async function createRedirect(
  oldName: string,
  newName: string
): Promise<boolean> {
  const { error } = await supabase.from("room_redirects").insert({
    old_name: oldName,
    new_name: newName,
    created_at: new Date().toISOString(),
    migrated: true,
  });

  if (error) {
    console.error(`Failed to create redirect ${oldName} → ${newName}:`, error);
    return false;
  }

  return true;
}

async function mergeRooms(
  sourceRoom: RoomRecord,
  targetRoom: RoomRecord
): Promise<boolean> {
  // Keep the target room's document (assumed to be the canonical one)
  // Just create a redirect from source to target
  const success = await createRedirect(sourceRoom.name, targetRoom.name);

  if (success) {
    console.log(`  Merged ${sourceRoom.name} → ${targetRoom.name}`);
  }

  return success;
}

function parseRoomId(roomId: string): {
  host: string | null;
  path: string | null;
} {
  try {
    // Decode the room ID first
    const decoded = decodeURIComponent(roomId);

    // Try to split by the first dash to separate host and path
    const dashIndex = decoded.indexOf("-");

    if (dashIndex === -1) {
      // No dash, it's a domain-only room
      return { host: decoded, path: null };
    }

    const host = decoded.substring(0, dashIndex);
    const path = decoded.substring(dashIndex + 1);

    return { host, path };
  } catch (e) {
    return { host: null, path: null };
  }
}

function attemptToFixRoomId(roomId: string): string | null {
  const { host, path } = parseRoomId(roomId);

  if (!host) {
    return null;
  }

  try {
    // Apply new normalization rules
    const normalizedHost = normalizeHost(host);
    const normalizedPath = path ? normalizePath(path) : undefined;

    // Create new room ID
    const newRoomId = createRoomId(normalizedHost, normalizedPath);

    // Only return if it's different and not invalid
    if (newRoomId !== roomId && !isInvalidRoomId(newRoomId)) {
      return newRoomId;
    }
  } catch (e) {
    // Failed to normalize
    return null;
  }

  return null;
}

async function auditAndMigrateRooms(
  options: {
    dryRun: boolean;
    mergeDuplicates: boolean;
  } = { dryRun: true, mergeDuplicates: false }
): Promise<MigrationResult> {
  console.log("=".repeat(60));
  console.log("Room ID Migration Script");
  console.log("=".repeat(60));
  console.log(`Mode: ${options.dryRun ? "DRY RUN (no changes)" : "LIVE"}`);
  console.log(`Merge duplicates: ${options.mergeDuplicates ? "YES" : "NO"}`);
  console.log("=".repeat(60));
  console.log();

  const result: MigrationResult = {
    totalRooms: 0,
    invalidRooms: [],
    wwwDuplicates: [],
    redirectsCreated: 0,
    roomsMerged: 0,
    errors: [],
  };

  // Fetch all rooms
  console.log("Fetching all rooms from database...");
  const rooms = await getAllRooms();
  result.totalRooms = rooms.length;
  console.log(`Found ${rooms.length} rooms\n`);

  // Group rooms by their potential normalized ID
  const roomsByNormalizedId = new Map<string, RoomRecord[]>();

  for (const room of rooms) {
    // Check if this room ID is invalid
    if (isInvalidRoomId(room.name)) {
      result.invalidRooms.push(room);
      console.log(`❌ Invalid room ID: ${room.name}`);
    }

    // Try to normalize the room ID
    const fixedRoomId = attemptToFixRoomId(room.name);

    if (fixedRoomId && fixedRoomId !== room.name) {
      console.log(`🔄 Room needs migration: ${room.name} → ${fixedRoomId}`);

      if (!roomsByNormalizedId.has(fixedRoomId)) {
        roomsByNormalizedId.set(fixedRoomId, []);
      }
      roomsByNormalizedId.get(fixedRoomId)!.push(room);
    }
  }

  console.log();
  console.log("-".repeat(60));
  console.log("Migration Summary:");
  console.log("-".repeat(60));
  console.log(`Total rooms: ${result.totalRooms}`);
  console.log(`Invalid rooms: ${result.invalidRooms.length}`);
  console.log(
    `Rooms needing migration: ${
      Array.from(roomsByNormalizedId.values()).reduce(
        (sum, group) => sum + group.length,
        0
      )
    }`
  );
  console.log();

  // Process migrations
  if (!options.dryRun) {
    console.log("Creating redirects...");

    for (const [normalizedId, roomGroup] of roomsByNormalizedId.entries()) {
      // Check if the normalized ID already exists as a room
      const targetExists = rooms.find((r) => r.name === normalizedId);

      if (targetExists && roomGroup.length > 0) {
        // Target exists, we need to merge
        console.log(
          `\n🔀 Target room exists: ${normalizedId} (merging ${roomGroup.length} rooms)`
        );

        if (options.mergeDuplicates) {
          for (const sourceRoom of roomGroup) {
            const success = await mergeRooms(sourceRoom, targetExists);
            if (success) {
              result.roomsMerged++;
            } else {
              result.errors.push({
                room: sourceRoom.name,
                error: "Failed to merge room",
              });
            }
          }
        } else {
          console.log(
            `  ⚠️  Skipping merge (use --merge-duplicates to enable)`
          );
        }
      } else if (roomGroup.length > 0) {
        // Target doesn't exist, create redirects and optionally rename the first one
        console.log(`\n➡️  Creating redirects to: ${normalizedId}`);

        for (const sourceRoom of roomGroup) {
          const success = await createRedirect(sourceRoom.name, normalizedId);
          if (success) {
            result.redirectsCreated++;
          } else {
            result.errors.push({
              room: sourceRoom.name,
              error: "Failed to create redirect",
            });
          }
        }
      }
    }
  }

  console.log();
  console.log("=".repeat(60));
  console.log("Migration Complete");
  console.log("=".repeat(60));
  console.log(`Redirects created: ${result.redirectsCreated}`);
  console.log(`Rooms merged: ${result.roomsMerged}`);
  console.log(`Errors: ${result.errors.length}`);

  if (result.errors.length > 0) {
    console.log();
    console.log("Errors:");
    for (const { room, error } of result.errors) {
      console.log(`  - ${room}: ${error}`);
    }
  }

  console.log("=".repeat(60));
  console.log();

  return result;
}

// Parse command line arguments
const args = process.argv.slice(2);
const dryRun = !args.includes("--live");
const mergeDuplicates = args.includes("--merge-duplicates");

// Run migration
auditAndMigrateRooms({ dryRun, mergeDuplicates })
  .then((result) => {
    if (dryRun) {
      console.log(
        "\n💡 This was a dry run. Use --live to apply changes to the database."
      );
    }
    process.exit(0);
  })
  .catch((error) => {
    console.error("Migration failed:", error);
    process.exit(1);
  });
