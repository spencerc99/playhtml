// ABOUTME: Session participant roster types and the pure upsert used by RosterAdmin.
// ABOUTME: Keyed by unique pid (last write wins) so concurrent writes can't duplicate.

export interface RosterEntry {
  pid: string;
  name: string;
  color: string;
}

/**
 * Upsert a participant into the roster, keyed by `pid`. Rebuilds the list from
 * a pid->entry map (last write wins), which both inserts/updates the given
 * participant and self-heals any duplicate entries already present. The result
 * preserves insertion order of first appearance, with the upserted entry taking
 * the latest name/color.
 */
export function upsertRoster(
  entries: RosterEntry[],
  entry: RosterEntry,
): RosterEntry[] {
  const byPid = new Map<string, RosterEntry>();
  for (const e of entries) byPid.set(e.pid, e);
  byPid.set(entry.pid, entry);
  return [...byPid.values()];
}

/**
 * True when `entries` already contains exactly `entry` (same name/color) for
 * its pid AND has no duplicate pids — i.e. an upsert would be a no-op. Used to
 * skip redundant writes (and the re-render they trigger).
 */
export function rosterIsCurrent(
  entries: RosterEntry[],
  entry: RosterEntry,
): boolean {
  const existing = entries.find((e) => e.pid === entry.pid);
  if (!existing) return false;
  if (existing.name !== entry.name || existing.color !== entry.color)
    return false;
  // No duplicates anywhere (a deduped roster has one entry per pid).
  const uniquePids = new Set(entries.map((e) => e.pid));
  return uniquePids.size === entries.length;
}
