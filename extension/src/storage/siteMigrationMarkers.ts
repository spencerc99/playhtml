// ABOUTME: Removes the per-site "migration_v1_done_<host>" markers that content scripts once wrote.
// ABOUTME: Runs once from the background and records that it finished under a single flag key.

import type { Storage } from 'webextension-polyfill';

const SITE_MIGRATION_MARKER_PREFIX = 'migration_v1_done_';
export const SITE_MIGRATION_MARKERS_REMOVED_KEY = 'site_migration_markers_removed';

type LocalStorageArea = Pick<Storage.LocalStorageArea, 'get' | 'set' | 'remove'>;

/**
 * Deletes every per-site migration marker from extension storage. Returns how
 * many were removed; 0 once the cleanup has already run.
 */
export async function removeSiteMigrationMarkers(
  storage: LocalStorageArea,
): Promise<number> {
  const done = await storage.get(SITE_MIGRATION_MARKERS_REMOVED_KEY);
  if (done[SITE_MIGRATION_MARKERS_REMOVED_KEY] === true) return 0;

  const everything = await storage.get(null);
  const markers = Object.keys(everything).filter((key) =>
    key.startsWith(SITE_MIGRATION_MARKER_PREFIX),
  );
  if (markers.length > 0) await storage.remove(markers);
  await storage.set({ [SITE_MIGRATION_MARKERS_REMOVED_KEY]: true });
  return markers.length;
}
