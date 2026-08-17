// ABOUTME: Verifies walking-record snapshots persist across new-tab page lifetimes.
// ABOUTME: Covers freshness, stale fallback, invalid data, and bounded storage.

import { beforeEach, describe, expect, it, vi } from "vitest";
import browser from "webextension-polyfill";
import type { WalkingRecord } from "../history/walkingRecord";
import {
  readWalkingRecordCache,
  WALKING_RECORD_CACHE_MAX_AGE_MS,
  writeWalkingRecordCache,
} from "../history/walkingRecordCache";

const record: WalkingRecord = {
  period: "week",
  range: { startTs: 1_000, endTs: 2_000 },
  rangeLabel: "aug 10 – 16, 2026",
  totalTimeMs: 60_000,
  totalTimeLabel: "1 min",
  cursorDistancePx: 100,
  pageCount: 1,
  hourBuckets: new Array(24).fill(0),
  movementCount: 0,
  departures: [],
  settledPlaces: [],
  dayPlates: [],
  landscapePaths: [],
  timeSpent: [],
};

describe("walking record cache", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns matching snapshots as fresh for fifteen minutes", async () => {
    vi.mocked(browser.storage.local.get).mockResolvedValue({
      walking_record_cache_v1: {
        version: 1,
        entries: [{ key: "week:1000:#4a9a8a", cachedAt: 10_000, record }],
      },
    });

    await expect(
      readWalkingRecordCache(
        "week:1000:#4a9a8a",
        10_000 + WALKING_RECORD_CACHE_MAX_AGE_MS,
      ),
    ).resolves.toEqual({ record, fresh: true });
  });

  it("returns an older matching snapshot while marking it stale", async () => {
    vi.mocked(browser.storage.local.get).mockResolvedValue({
      walking_record_cache_v1: {
        version: 1,
        entries: [{ key: "week:1000:#4a9a8a", cachedAt: 10_000, record }],
      },
    });

    await expect(
      readWalkingRecordCache(
        "week:1000:#4a9a8a",
        10_001 + WALKING_RECORD_CACHE_MAX_AGE_MS,
      ),
    ).resolves.toEqual({ record, fresh: false });
  });

  it("ignores cache data from another schema", async () => {
    vi.mocked(browser.storage.local.get).mockResolvedValue({
      walking_record_cache_v1: {
        version: 2,
        entries: [{ key: "week:1000:#4a9a8a", cachedAt: 10_000, record }],
      },
    });

    await expect(
      readWalkingRecordCache("week:1000:#4a9a8a", 10_000),
    ).resolves.toBeNull();
  });

  it("keeps only the six most recent snapshots", async () => {
    vi.mocked(browser.storage.local.get).mockResolvedValue({
      walking_record_cache_v1: {
        version: 1,
        entries: Array.from({ length: 6 }, (_, index) => ({
          key: `week:${index}:#4a9a8a`,
          cachedAt: index,
          record: {
            ...record,
            range: { startTs: index, endTs: index + 1 },
          },
        })),
      },
    });

    await writeWalkingRecordCache("week:latest:#4a9a8a", record, 10_000);

    expect(browser.storage.local.set).toHaveBeenCalledWith({
      walking_record_cache_v1: {
        version: 1,
        entries: expect.arrayContaining([
          expect.objectContaining({ key: "week:latest:#4a9a8a" }),
        ]),
      },
    });
    const stored = vi.mocked(browser.storage.local.set).mock.calls[0][0]
      .walking_record_cache_v1 as { entries: unknown[] };
    expect(stored.entries).toHaveLength(6);
  });
});
