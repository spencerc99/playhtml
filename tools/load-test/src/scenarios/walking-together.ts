// ABOUTME: walking-together scenario: users move cursors AND share URLs + join the roster.
// ABOUTME: Mirrors the real page so we can load-test ~100 active participants.

import type { Scenario } from "./index.js";

// Each virtual user behaves like a real walking-together participant:
//  - moves their cursor continuously (awareness, high frequency),
//  - upserts their roster entry (keyed map — idempotent, must stay bounded),
//  - periodically shares a URL into the chat (growing Y.Array).
//
// This exercises the load that took the room down (many active cursors +
// writes) and validates that the keyed-map roster stays bounded at scale.
//
// NOTE: the write paths here approximate the page's behavior, not its exact
// doc shape — the real page nests element data under `store.play["can-play"]`,
// while this writes directly under `store.play[...]`. The server is
// path-agnostic, so this faithfully reproduces the *load* (keyed upserts +
// array appends + awareness) even though the byte layout differs slightly.
export const walkingTogether: Scenario = {
  name: "walking-together",
  description:
    "Participants move cursors continuously and periodically share URLs + upsert a keyed roster entry. Models the real walking-together session under load.",
  defaults: {
    rampUpSeconds: 30,
    // ~1 URL share per 15s per user (a plausibly heavy workshop rate).
    writeRateHz: 1 / 15,
    // Cursors move at 10Hz — matches the real cursor send cadence ceiling.
    awarenessRateHz: 10,
  },
  tick(client, tickIndex, params) {
    // 1. Cursor movement (awareness) — high frequency.
    const ticksPerAwareness = Math.max(
      1,
      Math.round(10 / params.awarenessRateHz),
    );
    if (tickIndex % ticksPerAwareness === 0) {
      client.setAwareness({
        x: Math.random() * 1920,
        y: Math.random() * 1080,
        color: "#4a9a8a",
      });
    }

    // 2. Roster upsert — keyed map, in place. Every user re-asserts its own
    //    entry periodically (as the real RosterAdmin effect does on identity
    //    changes). With the keyed map this must NOT grow the doc unboundedly:
    //    writing entries[pid] overwrites in place. Done on a modest cadence
    //    (every ~5s) to mimic occasional re-renders without flooding.
    if (tickIndex % 50 === 0) {
      client.write(["walking-together-roster", "entries", client.clientId], {
        pid: client.clientId,
        name: client.clientId,
        color: "#4a9a8a",
      });
    }

    // 3. URL share — appended to the chat array (legitimately growing).
    const ticksPerWrite = Math.round(10 / params.writeRateHz);
    if (params.writeRateHz > 0 && tickIndex % ticksPerWrite === 0) {
      client.appendToArray(["url-chat", "urls"], {
        url: `https://example.com/${client.clientId}/${tickIndex}`,
        userName: client.clientId,
        userColor: "#4a9a8a",
        timestamp: Date.now(),
      });
    }
  },
};
