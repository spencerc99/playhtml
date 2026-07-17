// ABOUTME: Covers Worker event ingestion against the Supabase write boundary.
// ABOUTME: Verifies event upserts avoid returning rows while metadata history still reports inserts.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../lib/supabase';

const collectionEvents = {
  upsert: vi.fn(),
  select: vi.fn(),
};

const pageMetadataHistory = {
  select: vi.fn(),
  in: vi.fn(),
  is: vi.fn(),
  update: vi.fn(),
  eq: vi.fn(),
  insert: vi.fn(),
  single: vi.fn(),
};

vi.mock('../lib/supabase', () => ({
  createSupabaseClient: vi.fn(() => ({
    from: vi.fn((table: string) => {
      if (table === 'collection_events') {
        return collectionEvents;
      }
      if (table === 'page_metadata_history') {
        return pageMetadataHistory;
      }
      throw new Error(`Unexpected table: ${table}`);
    }),
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

function makeNavigationEvent(id: string) {
  return {
    id,
    type: 'navigation',
    ts: 1_700_000_000_000,
    data: {
      event: 'focus',
      page_ref: 'page-1',
      canonical_url: 'https://example.com/',
      title: 'Example',
      favicon_url: 'https://example.com/favicon.ico',
      metadata_hash: 'hash-1',
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
    pageMetadataHistory.select.mockReset();
    pageMetadataHistory.in.mockReset();
    pageMetadataHistory.is.mockReset();
    pageMetadataHistory.update.mockReset();
    pageMetadataHistory.eq.mockReset();
    pageMetadataHistory.insert.mockReset();
    pageMetadataHistory.single.mockReset();
    waitUntil.mockReset();

    collectionEvents.upsert.mockReturnValue({
      data: null,
      error: null,
      select: collectionEvents.select,
    });
    collectionEvents.select.mockResolvedValue({ data: [{ id: 'event-1' }], error: null });

    pageMetadataHistory.select.mockReturnValue(pageMetadataHistory);
    pageMetadataHistory.in.mockReturnValue(pageMetadataHistory);
    pageMetadataHistory.is.mockResolvedValue({ data: [], error: null });
    pageMetadataHistory.insert.mockReturnValue(pageMetadataHistory);
    pageMetadataHistory.single.mockResolvedValue({
      data: {
        id: 'metadata-1',
        page_ref: 'page-1',
        metadata_hash: 'hash-1',
      },
      error: null,
    });
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
});
