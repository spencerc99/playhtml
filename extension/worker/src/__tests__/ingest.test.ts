// ABOUTME: Covers Worker event ingestion against the Supabase write boundary.
// ABOUTME: Verifies event upserts avoid returning rows while metadata history still reports inserts.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../lib/supabase';

const collectionEvents = {
  upsert: vi.fn(),
  select: vi.fn(),
};

const metadataHistoryRpc = vi.fn();

vi.mock('../lib/supabase', () => ({
  createSupabaseClient: vi.fn(() => ({
    from: vi.fn((table: string) => {
      if (table === 'collection_events') {
        return collectionEvents;
      }
      throw new Error(`Unexpected table: ${table}`);
    }),
    rpc: metadataHistoryRpc,
  })),
}));

import { handleIngest } from '../routes/ingest';

const ENV: Env = {
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SECRET_KEY: 'k',
  ADMIN_KEY: 'a',
  RESEND_API_KEY: 'r',
  CODA_API_TOKEN: 'c',
  LIVE_EVENTS_HUB: {} as DurableObjectNamespace,
};

const waitUntil = vi.fn();
const CTX = { waitUntil } as unknown as ExecutionContext;

function makeRequest(events: unknown[]): Request {
  return new Request('https://example.com/events', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ events }),
  });
}

function makeNavigationEvent(
  id: string,
  {
    ts = 1_700_000_000_000,
    title = 'Example',
    metadataHash = 'hash-1',
  }: { ts?: number; title?: string; metadataHash?: string } = {},
) {
  return {
    id,
    type: 'navigation',
    ts,
    data: {
      event: 'focus',
      page_ref: 'page-1',
      canonical_url: 'https://example.com/',
      title,
      favicon_url: 'https://example.com/favicon.ico',
      metadata_hash: metadataHash,
    },
    meta: {
      pid: 'pid',
      sid: 'sid',
      url: 'https://example.com/',
      vw: 1024,
      vh: 768,
      tz: 'America/New_York',
    },
  };
}

describe('handleIngest', () => {
  beforeEach(() => {
    collectionEvents.upsert.mockReset();
    collectionEvents.select.mockReset();
    metadataHistoryRpc.mockReset();
    waitUntil.mockReset();

    collectionEvents.upsert.mockReturnValue({
      data: null,
      error: null,
      select: collectionEvents.select,
    });
    collectionEvents.select.mockResolvedValue({ data: [{ id: 'event-1' }], error: null });

    metadataHistoryRpc.mockResolvedValue({ data: true, error: null });
  });

  it('accepts event upserts without selecting inserted row ids', async () => {
    const event = makeNavigationEvent('event-1');

    const res = await handleIngest(makeRequest([event]), ENV, CTX);

    expect(res.status).toBe(200);
    expect(collectionEvents.upsert).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          id: 'event-1',
          participant_id: 'pid',
          session_id: 'sid',
        }),
      ],
      {
        onConflict: 'id',
        ignoreDuplicates: true,
      },
    );
    expect(collectionEvents.select).not.toHaveBeenCalled();
    expect(waitUntil).toHaveBeenCalledTimes(1);
    await expect(res.json()).resolves.toEqual({
      inserted: 1,
      duplicates: 0,
      page_metadata_inserted: 1,
    });
  });

  it('ignores an older retry that would overwrite the current metadata', async () => {
    metadataHistoryRpc.mockResolvedValue({ data: false, error: null });

    const res = await handleIngest(
      makeRequest([
        makeNavigationEvent('retried-event', {
          metadataHash: 'hash-retried',
        }),
      ]),
      ENV,
      CTX,
    );

    expect(res.status).toBe(200);
    expect(metadataHistoryRpc).toHaveBeenCalledWith(
      'record_page_metadata_snapshot',
      expect.objectContaining({ p_metadata_hash: 'hash-retried' }),
    );
    await expect(res.json()).resolves.toMatchObject({ page_metadata_inserted: 0 });
  });

  it('keeps metadata snapshots in observation order within one request', async () => {
    const res = await handleIngest(
      makeRequest([
        makeNavigationEvent('newest-event', {
          ts: 1_700_000_000_200,
          title: 'Newest title',
          metadataHash: 'hash-newest',
        }),
        makeNavigationEvent('older-event', {
          ts: 1_700_000_000_100,
          title: 'Older title',
          metadataHash: 'hash-older',
        }),
      ]),
      ENV,
      CTX,
    );

    expect(res.status).toBe(200);
    expect(metadataHistoryRpc).toHaveBeenCalledTimes(2);
    expect(metadataHistoryRpc).toHaveBeenNthCalledWith(
      1,
      'record_page_metadata_snapshot',
      expect.objectContaining({ p_metadata_hash: 'hash-older' }),
    );
    expect(metadataHistoryRpc).toHaveBeenNthCalledWith(
      2,
      'record_page_metadata_snapshot',
      expect.objectContaining({ p_metadata_hash: 'hash-newest' }),
    );
  });

  it('does not duplicate history when a navigation event id is retried', async () => {
    const event = makeNavigationEvent('duplicate-event');
    metadataHistoryRpc
      .mockResolvedValueOnce({ data: true, error: null })
      .mockResolvedValueOnce({ data: false, error: null });

    const res = await handleIngest(makeRequest([event, event]), ENV, CTX);

    expect(res.status).toBe(200);
    expect(metadataHistoryRpc).toHaveBeenCalledTimes(2);
    await expect(res.json()).resolves.toMatchObject({ page_metadata_inserted: 1 });
  });

  it('sends concurrent snapshots through the metadata RPC', async () => {
    await Promise.all([
      handleIngest(
        makeRequest([
          makeNavigationEvent('concurrent-first', { metadataHash: 'hash-first' }),
        ]),
        ENV,
        CTX,
      ),
      handleIngest(
        makeRequest([
          makeNavigationEvent('concurrent-second', { metadataHash: 'hash-second' }),
        ]),
        ENV,
        CTX,
      ),
    ]);

    expect(metadataHistoryRpc).toHaveBeenCalledTimes(2);
  });
});
