#!/usr/bin/env bun
/**
 * Script to cleanup orphaned playhtml data for a specific room.
 *
 * Usage:
 *   bun scripts/cleanup-orphans.ts <roomId> <tag> <activeIds...>
 *
 * Example for fridge:
 *   bun scripts/cleanup-orphans.ts "playhtml.fun-fridge" "can-move" "id1" "id2" "id3"
 *
 * Or with a dry run:
 *   DRY_RUN=true bun scripts/cleanup-orphans.ts "playhtml.fun-fridge" "can-move" "id1" "id2"
 *
 * Environment variables:
 *   ADMIN_TOKEN - Admin token for authentication (required)
 *   PARTYKIT_HOST - PartyKit host (defaults to production)
 *   DRY_RUN - Set to "true" to perform a dry run without actually deleting
 */

const ADMIN_TOKEN = process.env.ADMIN_TOKEN;
const PARTYKIT_HOST =
  process.env.PARTYKIT_HOST || "playhtml.spencerc99.partykit.dev";
const DRY_RUN = process.env.DRY_RUN === "true";

if (!ADMIN_TOKEN) {
  console.error("Error: ADMIN_TOKEN environment variable is required");
  console.error(
    "Set it with: export ADMIN_TOKEN=your_token_here"
  );
  process.exit(1);
}

const args = process.argv.slice(2);

if (args.length < 3) {
  console.error("Usage: bun scripts/cleanup-orphans.ts <roomId> <tag> <activeIds...>");
  console.error("");
  console.error("Example:");
  console.error(
    '  bun scripts/cleanup-orphans.ts "playhtml.fun-fridge" "can-move" "id1" "id2" "id3"'
  );
  console.error("");
  console.error("For a dry run:");
  console.error('  DRY_RUN=true bun scripts/cleanup-orphans.ts "playhtml.fun-fridge" "can-move" "id1" "id2"');
  process.exit(1);
}

const [roomId, tag, ...activeIds] = args;

if (DRY_RUN) {
  console.log("🔍 DRY RUN MODE - No data will be deleted");
}

console.log(`Room: ${roomId}`);
console.log(`Tag: ${tag}`);
console.log(`Active IDs: ${activeIds.length}`);
console.log("");

const url = `https://${PARTYKIT_HOST}/parties/main/${encodeURIComponent(
  roomId
)}/admin/cleanup-orphans?token=${ADMIN_TOKEN}`;

try {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      tag,
      activeIds,
      dryRun: DRY_RUN,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`Error: ${response.status} ${response.statusText}`);
    console.error(errorText);
    process.exit(1);
  }

  const result = await response.json();

  if (DRY_RUN) {
    console.log("📊 Dry Run Results:");
    console.log(`  Total entries: ${result.total}`);
    console.log(`  Active entries: ${result.active}`);
    console.log(`  Orphaned entries: ${result.orphaned}`);
    if (result.orphanedIds && result.orphanedIds.length > 0) {
      console.log(`  Orphaned IDs (first 10):`);
      result.orphanedIds.slice(0, 10).forEach((id: string) => {
        console.log(`    - ${id}`);
      });
      if (result.orphanedIds.length > 10) {
        console.log(`    ... and ${result.orphanedIds.length - 10} more`);
      }
    }
  } else {
    console.log("✅ Cleanup completed!");
    console.log(`  Total entries: ${result.total}`);
    console.log(`  Active entries: ${result.active}`);
    console.log(`  Removed entries: ${result.removed}`);
  }

  console.log("");
  console.log(result.message);
} catch (error) {
  console.error("Failed to cleanup orphans:", error);
  process.exit(1);
}

