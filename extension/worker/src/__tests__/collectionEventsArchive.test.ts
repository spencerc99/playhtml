// ABOUTME: Tests collection_events archive planning against the Supabase boundary.
// ABOUTME: Verifies dry-run manifests identify one safe, closed archive window.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../lib/supabase';
import {
  planCollectionEventsArchive,
  planCollectionEventsArchiveIfEnabled,
  scheduleCollectionEventsArchive,
} from '../archive/collectionEvents';

const oldestEvents = {
  select: vi.fn(),
  lt: vi.fn(),
  order: vi.fn(),
  limit: vi.fn(),
  maybeSingle: vi.fn(),
};

const countedEvents = {
  select: vi.fn(),
  eq: vi.fn(),
  gte: vi.fn(),
  lt: vi.fn(),
};

const archives = {
  upsert: vi.fn(),
};

vi.mock('../lib/supabase', () => ({
  createSupabaseClient: vi.fn(() => ({
    from: vi
      .fn()
      .mockReturnValueOnce(oldestEvents)
      .mockReturnValueOnce(countedEvents)
      .mockReturnValueOnce(archives),
  })),
}));

const ENV: Env = {
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SECRET_KEY: 'k',
  ADMIN_KEY: 'a',
  RESEND_API_KEY: 'r',
  LIVE_EVENTS_HUB: {} as DurableObjectNamespace,
};

describe('planCollectionEventsArchive', () => {
  beforeEach(() => {
    oldestEvents.select.mockReset();
    oldestEvents.lt.mockReset();
    oldestEvents.order.mockReset();
    oldestEvents.limit.mockReset();
    oldestEvents.maybeSingle.mockReset();
    countedEvents.select.mockReset();
    countedEvents.eq.mockReset();
    countedEvents.gte.mockReset();
    countedEvents.lt.mockReset();
    archives.upsert.mockReset();

    oldestEvents.select.mockReturnValue(oldestEvents);
    oldestEvents.lt.mockReturnValue(oldestEvents);
    oldestEvents.order.mockReturnValue(oldestEvents);
    oldestEvents.limit.mockReturnValue(oldestEvents);
    countedEvents.select.mockReturnValue(countedEvents);
    countedEvents.eq.mockReturnValue(countedEvents);
    countedEvents.gte.mockReturnValue(countedEvents);
  });

  it('writes a planned manifest for the oldest eligible type and hour', async () => {
    oldestEvents.maybeSingle.mockResolvedValue({
      data: { id: 'event-1', type: 'cursor', ts: '2026-04-01T09:23:45.000Z' },
      error: null,
    });
    countedEvents.lt.mockResolvedValue({ count: 42, error: null });
    archives.upsert.mockResolvedValue({ error: null });

    const result = await planCollectionEventsArchive(ENV, {
      now: new Date('2026-06-14T12:00:00.000Z'),
      retentionDays: 60,
    });

    expect(oldestEvents.lt).toHaveBeenCalledWith('ts', '2026-04-15T12:00:00.000Z');
    expect(countedEvents.eq).toHaveBeenCalledWith('type', 'cursor');
    expect(countedEvents.gte).toHaveBeenCalledWith('ts', '2026-04-01T09:00:00.000Z');
    expect(countedEvents.lt).toHaveBeenCalledWith('ts', '2026-04-01T10:00:00.000Z');
    expect(archives.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'planned',
        event_type: 'cursor',
        window_start: '2026-04-01T09:00:00.000Z',
        window_end: '2026-04-01T10:00:00.000Z',
        row_count: 42,
        r2_key:
          'collection-events/type=cursor/day=2026-04-01/chunk=2026-04-01T09-00-00-000Z_2026-04-01T10-00-00-000Z.jsonl.gz',
      }),
      { onConflict: 'r2_key' },
    );
    expect(result).toEqual({
      status: 'planned',
      eventType: 'cursor',
      rowCount: 42,
      windowStart: '2026-04-01T09:00:00.000Z',
      windowEnd: '2026-04-01T10:00:00.000Z',
      r2Key:
        'collection-events/type=cursor/day=2026-04-01/chunk=2026-04-01T09-00-00-000Z_2026-04-01T10-00-00-000Z.jsonl.gz',
    });
  });

  it('plans only fully closed archive hours before the retention cutoff', async () => {
    oldestEvents.maybeSingle.mockResolvedValue({
      data: { id: 'event-1', type: 'cursor', ts: '2026-04-15T11:59:59.000Z' },
      error: null,
    });
    countedEvents.lt.mockResolvedValue({ count: 7, error: null });
    archives.upsert.mockResolvedValue({ error: null });

    const result = await planCollectionEventsArchive(ENV, {
      now: new Date('2026-06-14T12:34:56.000Z'),
      retentionDays: 60,
    });

    expect(oldestEvents.lt).toHaveBeenCalledWith('ts', '2026-04-15T12:00:00.000Z');
    expect(countedEvents.gte).toHaveBeenCalledWith('ts', '2026-04-15T11:00:00.000Z');
    expect(countedEvents.lt).toHaveBeenCalledWith('ts', '2026-04-15T12:00:00.000Z');
    expect(result).toEqual(
      expect.objectContaining({
        windowStart: '2026-04-15T11:00:00.000Z',
        windowEnd: '2026-04-15T12:00:00.000Z',
        r2Key:
          'collection-events/type=cursor/day=2026-04-15/chunk=2026-04-15T11-00-00-000Z_2026-04-15T12-00-00-000Z.jsonl.gz',
      }),
    );
  });

  it('keeps the archive key stable when repeated within the same cutoff hour', async () => {
    oldestEvents.maybeSingle.mockResolvedValue({
      data: { id: 'event-1', type: 'cursor', ts: '2026-04-15T11:59:59.000Z' },
      error: null,
    });
    countedEvents.lt.mockResolvedValue({ count: 7, error: null });
    archives.upsert.mockResolvedValue({ error: null });

    const first = await planCollectionEventsArchive(ENV, {
      now: new Date('2026-06-14T12:05:00.000Z'),
      retentionDays: 60,
    });

    const second = await planCollectionEventsArchive(ENV, {
      now: new Date('2026-06-14T12:55:00.000Z'),
      retentionDays: 60,
    });

    expect(first).toEqual(second);
  });

  it('throws instead of writing a manifest when Supabase omits the exact count', async () => {
    oldestEvents.maybeSingle.mockResolvedValue({
      data: { id: 'event-1', type: 'cursor', ts: '2026-04-01T09:23:45.000Z' },
      error: null,
    });
    countedEvents.lt.mockResolvedValue({ count: null, error: null });

    await expect(
      planCollectionEventsArchive(ENV, {
        now: new Date('2026-06-14T12:00:00.000Z'),
        retentionDays: 60,
      }),
    ).rejects.toThrow('Archive window count was not returned');
    expect(archives.upsert).not.toHaveBeenCalled();
  });

  it('rejects invalid retention day configuration', async () => {
    await expect(
      planCollectionEventsArchive({
        ...ENV,
        COLLECTION_EVENTS_ARCHIVE_RETENTION_DAYS: '0',
      }),
    ).rejects.toThrow('COLLECTION_EVENTS_ARCHIVE_RETENTION_DAYS must be a positive integer');
    expect(oldestEvents.select).not.toHaveBeenCalled();
  });

  it('skips planning when no events are beyond the retention window', async () => {
    oldestEvents.maybeSingle.mockResolvedValue({ data: null, error: null });

    const result = await planCollectionEventsArchive(ENV, {
      now: new Date('2026-06-14T12:00:00.000Z'),
      retentionDays: 60,
    });

    expect(countedEvents.select).not.toHaveBeenCalled();
    expect(archives.upsert).not.toHaveBeenCalled();
    expect(result).toEqual({ status: 'skipped', reason: 'no_eligible_events' });
  });

  it('does not plan archive windows unless archival is enabled', async () => {
    const result = await planCollectionEventsArchiveIfEnabled({
      ...ENV,
      COLLECTION_EVENTS_ARCHIVE_ENABLED: 'false',
    });

    expect(oldestEvents.select).not.toHaveBeenCalled();
    expect(result).toEqual({ status: 'skipped', reason: 'disabled' });
  });

  it('schedules archive planning on the worker execution context', async () => {
    const waitUntil = vi.fn();

    scheduleCollectionEventsArchive(
      { ...ENV, COLLECTION_EVENTS_ARCHIVE_ENABLED: 'false' },
      { waitUntil } as unknown as ExecutionContext,
    );

    expect(waitUntil).toHaveBeenCalledTimes(1);
    await expect(waitUntil.mock.calls[0][0]).resolves.toEqual({
      status: 'skipped',
      reason: 'disabled',
    });
  });
});
