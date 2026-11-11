// ABOUTME: Tests the one-time removal of per-site migration markers from extension storage.
// ABOUTME: Other keys survive, and a second run does not read all of storage again.

import { describe, expect, it, vi } from "vitest";
import {
  removeSiteMigrationMarkers,
  SITE_MIGRATION_MARKERS_REMOVED_KEY,
} from "../storage/siteMigrationMarkers";

function memoryStorage(initial: Record<string, unknown>) {
  const data: Record<string, unknown> = { ...initial };
  return {
    data,
    get: vi.fn(async (keys: string | string[] | null) => {
      if (keys === null) return { ...data };
      const list = typeof keys === "string" ? [keys] : keys;
      return Object.fromEntries(
        list.filter((key) => key in data).map((key) => [key, data[key]]),
      );
    }),
    set: vi.fn(async (items: Record<string, unknown>) => {
      Object.assign(data, items);
    }),
    remove: vi.fn(async (keys: string | string[]) => {
      for (const key of typeof keys === "string" ? [keys] : keys) delete data[key];
    }),
  };
}

describe("removeSiteMigrationMarkers", () => {
  it("removes every per-site marker, keeps other keys, and records that it ran", async () => {
    const storage = memoryStorage({
      "migration_v1_done_example.com": true,
      "migration_v1_done_en.wikipedia.org": true,
      playerIdentity: { publicKey: "pk_a" },
      collection_mode_cursor: "shared",
    });

    const removed = await removeSiteMigrationMarkers(storage as never);

    expect(removed).toBe(2);
    expect(storage.data).toEqual({
      playerIdentity: { publicKey: "pk_a" },
      collection_mode_cursor: "shared",
      [SITE_MIGRATION_MARKERS_REMOVED_KEY]: true,
    });
  });

  it("does nothing once it has run", async () => {
    const storage = memoryStorage({
      [SITE_MIGRATION_MARKERS_REMOVED_KEY]: true,
      "migration_v1_done_late.example": true,
    });

    expect(await removeSiteMigrationMarkers(storage as never)).toBe(0);
    expect(storage.get).not.toHaveBeenCalledWith(null);
    expect(storage.remove).not.toHaveBeenCalled();
  });
});
