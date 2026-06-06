// ABOUTME: Session participant roster types and helpers, keyed by pid.
// ABOUTME: A keyed map (not an array) so upserts are idempotent and merge-safe.

export interface RosterEntry {
  pid: string;
  name: string;
  color: string;
}

/**
 * The roster is a map keyed by participant id. Modeling it as a keyed object —
 * rather than an array — means upserting a participant is a single keyed write
 * (`entries[pid] = entry`) that overwrites in place. Writing the same pid any
 * number of times can never duplicate, and concurrent writes from different
 * clients merge cleanly (Yjs maps are last-write-wins per key, vs. arrays which
 * append). This is the structural defense against the runaway-append bug that
 * previously grew the room document until it crashed the sync server.
 */
export type Roster = Record<string, RosterEntry>;

/**
 * Coerce a stored roster value into the keyed-map shape. Tolerates a legacy
 * array value (the pre-keyed-map format) by re-keying it by pid, so a room
 * persisted under the old shape reads correctly instead of producing junk
 * numeric keys. New writes always use the keyed map.
 */
function normalizeRoster(value: Roster | RosterEntry[] | undefined): Roster {
  if (!value) return {};
  if (Array.isArray(value)) {
    const map: Roster = {};
    for (const e of value) if (e && e.pid) map[e.pid] = e;
    return map;
  }
  return value;
}

/** Distinct participant ids in the roster. */
export function rosterPids(roster: Roster | RosterEntry[] | undefined): string[] {
  return Object.keys(normalizeRoster(roster));
}

/** The roster entries as a list (e.g. for counting or display). */
export function rosterEntries(
  roster: Roster | RosterEntry[] | undefined,
): RosterEntry[] {
  return Object.values(normalizeRoster(roster));
}

/**
 * True when the roster already holds exactly `entry` for its pid — i.e. an
 * upsert would be a no-op. Used to skip redundant writes (and the re-render
 * they would trigger).
 */
export function rosterEntryIsCurrent(
  roster: Roster,
  entry: RosterEntry,
): boolean {
  const existing = roster[entry.pid];
  return (
    !!existing && existing.name === entry.name && existing.color === entry.color
  );
}
