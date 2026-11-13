// ABOUTME: Covers Worker event ingestion against the Supabase write boundary.
// ABOUTME: Verifies event validation, upserts that avoid returning rows, and deferred metadata history writes.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../lib/supabase';

const collectionEvents = {
  upsert: vi.fn(),
  select: vi.fn(),
};

const metadataHistoryRpc = vi.fn();

const participants = {
  select: vi.fn(),
  in: vi.fn(),
};

vi.mock('../lib/supabase', () => ({
  createSupabaseClient: vi.fn(() => ({
    from: vi.fn((table: string) => {
      if (table === 'collection_events') {
        return collectionEvents;
      }
      if (table === 'participants') {
        return participants;
      }
      throw new Error(`Unexpected table: ${table}`);
    }),
    rpc: metadataHistoryRpc,
  })),
}));

import { collapsePageMetadataSnapshots, handleIngest } from '../routes/ingest';

const ENV: Env = {
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SECRET_KEY: 'k',
  ADMIN_KEY: 'a',
  RESEND_API_KEY: 'r',
  CODA_API_TOKEN: 'c',
  LIVE_EVENTS_HUB: {
    idFromName: () => ({}) as DurableObjectId,
    get: () => ({
      fetch: async () => new Response(null, { status: 204 }),
    }),
  } as unknown as DurableObjectNamespace,
  COMMUTE_TRAIN_DISPATCHER: {} as DurableObjectNamespace,
  COMMUTE_BOARD_RATE_LIMITER: {
    limit: async () => ({ success: true }),
  },
  WWO_ADMIN_DB: {} as D1Database,
  INTERNET_MAP_BUNDLES: {} as R2Bucket,
  SHARED_COLLAGES: {} as R2Bucket,
  COLLAGE_SHARE_RATE_LIMITER: {
    limit: async () => ({ success: true }),
  },
};

const backgroundWork: Promise<unknown>[] = [];
const waitUntil = vi.fn((promise: Promise<unknown>) => {
  backgroundWork.push(promise);
});
const CTX = { waitUntil } as unknown as ExecutionContext;

/** Settles everything the handler deferred with ctx.waitUntil. */
async function flushBackgroundWork(): Promise<void> {
  while (backgroundWork.length > 0) {
    await Promise.all(backgroundWork.splice(0));
  }
}

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
    participants.select.mockReset();
    participants.in.mockReset();
    waitUntil.mockClear();
    backgroundWork.length = 0;

    collectionEvents.upsert.mockReturnValue({
      data: null,
      error: null,
      select: collectionEvents.select,
    });
    collectionEvents.select.mockResolvedValue({ data: [{ id: 'event-1' }], error: null });

    metadataHistoryRpc.mockResolvedValue({ data: true, error: null });
    participants.select.mockReturnValue(participants);
    participants.in.mockResolvedValue({ data: [] });
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
    // One deferred write for page metadata, one for the live broadcast.
    expect(waitUntil).toHaveBeenCalledTimes(2);
    await expect(res.json()).resolves.toEqual({
      inserted: 1,
      duplicates: 0,
      page_metadata_queued: 1,
    });
    await flushBackgroundWork();
    expect(metadataHistoryRpc).toHaveBeenCalledTimes(1);
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
    await flushBackgroundWork();
    expect(metadataHistoryRpc).toHaveBeenCalledWith(
      'record_page_metadata_snapshot',
      expect.objectContaining({ p_metadata_hash: 'hash-retried' }),
    );
    await expect(res.json()).resolves.toMatchObject({ page_metadata_queued: 1 });
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
    await flushBackgroundWork();
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

    const res = await handleIngest(makeRequest([event, event]), ENV, CTX);

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ page_metadata_queued: 1 });
    await flushBackgroundWork();
    expect(metadataHistoryRpc).toHaveBeenCalledTimes(1);
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

    await flushBackgroundWork();
    expect(metadataHistoryRpc).toHaveBeenCalledTimes(2);
  });

  it('answers before the metadata history write finishes and survives its failure', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    metadataHistoryRpc.mockResolvedValue({ data: null, error: { message: 'rpc down' } });

    const res = await handleIngest(makeRequest([makeNavigationEvent('event-1')]), ENV, CTX);

    expect(res.status).toBe(200);
    await flushBackgroundWork();
    expect(warn).toHaveBeenCalledWith(
      '[Ingest] Page metadata history write skipped:',
      { message: 'rpc down' },
    );
    warn.mockRestore();
  });

  it.each([
    ['javascript:', 'javascript:alert(1)'],
    ['data:', 'data:text/html,hi'],
    ['chrome-extension:', 'chrome-extension://abc/popup.html'],
    ['unparseable', 'not a url'],
    ['non-string', 42],
  ])('rejects a %s meta.url with a 400 naming its index', async (_label, url) => {
    const good = makeNavigationEvent('good');
    const bad = { ...makeNavigationEvent('bad'), meta: { ...good.meta, url } };

    const res = await handleIngest(makeRequest([good, bad]), ENV, CTX);

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({
      error: 'Invalid meta.url at index 1: expected an http(s) or file URL',
    });
    expect(collectionEvents.upsert).not.toHaveBeenCalled();
  });

  it('accepts http, https, and file page URLs', async () => {
    const events = ['http://example.com/', 'https://example.com/', 'file:///Users/me/notes.html'].map(
      (url, index) => ({ ...makeNavigationEvent(`event-${index}`), meta: { ...makeNavigationEvent('x').meta, url } }),
    );

    const res = await handleIngest(makeRequest(events), ENV, CTX);

    expect(res.status).toBe(200);
  });

  it.each([
    ['a string', '2026-01-01'],
    ['out of Date range', 1e20],
  ])('rejects a ts that is %s with a 400 naming its index', async (_label, ts) => {
    const bad = { ...makeNavigationEvent('bad'), ts };

    const res = await handleIngest(makeRequest([bad]), ENV, CTX);

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({
      error: 'Invalid ts at index 0: expected epoch milliseconds',
    });
    expect(collectionEvents.upsert).not.toHaveBeenCalled();
  });

  it('rejects a null entry with a 400 instead of a 500', async () => {
    const res = await handleIngest(
      makeRequest([makeNavigationEvent('good'), null]),
      ENV,
      CTX,
    );

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({
      error: 'Invalid event at index 1: not an object',
    });
  });
});

describe('collapsePageMetadataSnapshots', () => {
  const snapshot = (page_ref: string, metadata_hash: string, observed_at_ts: number) => ({
    page_ref,
    canonical_url: `https://example.com/${page_ref}`,
    title: metadata_hash,
    favicon_url: '',
    metadata_hash,
    observed_at_ts,
  });

  it('keeps the first and last of a run of identical metadata', () => {
    const collapsed = collapsePageMetadataSnapshots([
      snapshot('a', 'h1', 3),
      snapshot('a', 'h1', 1),
      snapshot('a', 'h1', 2),
    ]);

    expect(collapsed.map((s) => s.observed_at_ts)).toEqual([1, 3]);
  });

  it('keeps a page returning to earlier metadata as its own run', () => {
    const collapsed = collapsePageMetadataSnapshots([
      snapshot('a', 'h1', 1),
      snapshot('a', 'h1', 2),
      snapshot('a', 'h2', 3),
      snapshot('a', 'h1', 4),
      snapshot('b', 'h1', 5),
    ]);

    expect(collapsed.map((s) => [s.page_ref, s.metadata_hash, s.observed_at_ts])).toEqual([
      ['a', 'h1', 1],
      ['a', 'h1', 2],
      ['a', 'h2', 3],
      ['a', 'h1', 4],
      ['b', 'h1', 5],
    ]);
  });
});
