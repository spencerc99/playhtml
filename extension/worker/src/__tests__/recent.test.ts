// ABOUTME: Tests stable pagination for recent extension events.
// ABOUTME: Verifies live inserts cannot shift later pages onto duplicate rows.

import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { Env } from '../lib/supabase';

const { createSupabaseClient } = vi.hoisted(() => ({
  createSupabaseClient: vi.fn(),
}));

vi.mock('../lib/supabase', () => ({ createSupabaseClient }));

import { getEarlierEventFilter } from '../lib/eventCursorFilter';
import { pageEventUrlVariants, parseUrlHashes } from '../../../src/utils/pageEventUrls';
import {
  getRecentEventTypeFilter,
  handleRecent,
  loadRecentEventRows,
  loadRecentEvents,
  loadRecentParticipantIds,
} from '../routes/recent';

/** Records the PostgREST query chain and answers it with `result`. */
function recordParticipantQuery(result: { data: unknown; error: { message: string } | null }) {
  const calls: Array<[string, ...unknown[]]> = [];
  const builder = {
    from: (...args: unknown[]) => { calls.push(['from', ...args]); return builder; },
    select: (...args: unknown[]) => { calls.push(['select', ...args]); return builder; },
    gte: (...args: unknown[]) => { calls.push(['gte', ...args]); return builder; },
    order: (...args: unknown[]) => { calls.push(['order', ...args]); return builder; },
    limit: (...args: unknown[]) => { calls.push(['limit', ...args]); return Promise.resolve(result); },
  };
  createSupabaseClient.mockReturnValue(builder);
  return calls;
}

function makeRow(index: number): Record<string, unknown> {
  return {
    id: `event-${index.toString().padStart(4, '0')}`,
    type: 'cursor',
    ts: new Date(Date.UTC(2026, 0, 2) - index * 1000).toISOString(),
    participant_id: 'participant',
    session_id: 'session',
    url: 'https://example.com/',
    viewport_width: 1024,
    viewport_height: 768,
    timezone: 'America/Los_Angeles',
    data: { event: 'move' },
  };
}

describe('recent event pagination', () => {
  it('defaults to cursor events and supports an explicit all-event request', () => {
    expect(
      getRecentEventTypeFilter(new URL('https://worker.example/events/recent')),
    ).toBe('cursor');
    expect(
      getRecentEventTypeFilter(
        new URL('https://worker.example/events/recent?type=keyboard'),
      ),
    ).toBe('keyboard');
    expect(
      getRecentEventTypeFilter(
        new URL('https://worker.example/events/recent?type=all'),
      ),
    ).toBeNull();
  });

  it('continues after the last row instead of using a shifted offset', async () => {
    const storedRows = Array.from({ length: 1001 }, (_, index) => makeRow(index));
    let pageCount = 0;

    const result = await loadRecentEventRows(1001, async (cursor, pageSize) => {
      pageCount += 1;
      if (pageCount === 2) storedRows.unshift(makeRow(-1));

      const rows = storedRows
        .filter((row) => {
          if (!cursor) return true;
          const ts = row.ts as string;
          const id = row.id as string;
          return ts < cursor.ts || (ts === cursor.ts && id < cursor.id);
        })
        .sort((a, b) => {
          const tsOrder = (b.ts as string).localeCompare(a.ts as string);
          return tsOrder || (b.id as string).localeCompare(a.id as string);
        })
        .slice(0, pageSize);

      return { data: rows, error: null };
    });

    if (result.error) throw new Error(result.error.message);
    const events = result.rows;

    expect(events).toHaveLength(1001);
    expect(new Set(events.map((event) => event.id)).size).toBe(1001);
    expect(events.at(-1)?.id).toBe('event-1000');
  });

  it('builds a stable filter for equal timestamps and quoted ids', () => {
    expect(
      getEarlierEventFilter(
        '2026-01-01T23:43:21.000Z',
        'event-"0999"',
      ),
    ).toBe(
      'ts.lt."2026-01-01T23:43:21.000Z",and(ts.eq."2026-01-01T23:43:21.000Z",id.lt."event-\\"0999\\"")',
    );
  });
});

describe('recent participant ids', () => {
  const env = {} as Env;

  it('selects only participant ids of the newest events in the window', async () => {
    const calls = recordParticipantQuery({
      data: [{ participant_id: 'one' }, { participant_id: 'two' }, { participant_id: 'one' }],
      error: null,
    });

    const ids = await loadRecentParticipantIds(env, Date.UTC(2026, 0, 2, 0, 0, 0), 1000);

    expect(ids).toEqual(['one', 'two', 'one']);
    expect(calls).toEqual([
      ['from', 'collection_events'],
      ['select', 'participant_id'],
      ['gte', 'ts', '2026-01-02T00:00:00.000Z'],
      ['order', 'ts', { ascending: false }],
      ['limit', 1000],
    ]);
  });

  it('rejects a limit larger than one Supabase page', async () => {
    recordParticipantQuery({ data: [], error: null });
    await expect(loadRecentParticipantIds(env, 0, 1001)).rejects.toThrow(
      'Participant id limit 1001 exceeds one Supabase page',
    );
  });

  it('throws on query errors and rows without a participant id', async () => {
    recordParticipantQuery({ data: null, error: { message: 'timeout' } });
    await expect(loadRecentParticipantIds(env, 0, 10)).rejects.toThrow(
      'Recent participant query failed: timeout',
    );
    recordParticipantQuery({ data: [{ participant_id: null }], error: null });
    await expect(loadRecentParticipantIds(env, 0, 10)).rejects.toThrow(
      'Recent participant row is missing participant_id',
    );
  });
});

type QueryResult = { data: unknown; error: { message: string } | null };

/**
 * Answers each table's terminal query with that table's result and records
 * how many page_metadata_history queries are in flight at once.
 */
function fakeEventTables(results: {
  events: QueryResult;
  pageMeta: (refs: string[]) => QueryResult;
  participants: QueryResult;
}) {
  const metaCalls: string[][] = [];
  let metaInFlight = 0;
  let maxMetaInFlight = 0;
  const client = {
    from(table: string) {
      const builder: Record<string, unknown> = {};
      const chain = () => builder;
      for (const method of ['select', 'eq', 'gte', 'lte', 'or', 'order']) builder[method] = chain;
      builder.limit = async () => results.events;
      builder.in = (_column: string, values: string[]) => {
        if (table === 'participants') return Promise.resolve(results.participants);
        return {
          is: async () => {
            metaCalls.push(values);
            metaInFlight += 1;
            maxMetaInFlight = Math.max(maxMetaInFlight, metaInFlight);
            await new Promise((resolve) => setTimeout(resolve, 1));
            metaInFlight -= 1;
            return results.pageMeta(values);
          },
        };
      };
      return builder;
    },
  };
  createSupabaseClient.mockReturnValue(client);
  return { metaCalls, maxMetaInFlight: () => maxMetaInFlight };
}

function navigationRow(index: number): Record<string, unknown> {
  return { ...makeRow(index), type: 'navigation', data: { page_ref: `ref-${index}` } };
}

const ALL_NAVIGATION = {
  type: 'navigation',
  limit: 1000,
  domain: null,
  urlHashes: null,
  pid: null,
  from: null,
  to: null,
  requireTitle: true,
} as const;

describe('recent events with page metadata', () => {
  const env = {} as Env;

  it('looks up page metadata in concurrent chunks and keeps only titled events', async () => {
    const rows = Array.from({ length: 900 }, (_, index) => navigationRow(index));
    const tables = fakeEventTables({
      events: { data: rows, error: null },
      pageMeta: (refs) => ({
        data: refs
          .filter((ref) => ref !== 'ref-5')
          .map((ref) => ({ page_ref: ref, title: `Title ${ref}`, favicon_url: null })),
        error: null,
      }),
      participants: { data: [{ pid: 'participant', cursor_color: '#4a9a8a' }], error: null },
    });

    const result = await loadRecentEvents(env, ALL_NAVIGATION);
    if (result.error) throw new Error(result.error.message);

    expect(tables.metaCalls.map((refs) => refs.length)).toEqual([200, 200, 200, 200, 100]);
    expect(tables.maxMetaInFlight()).toBeGreaterThan(1);
    expect(tables.maxMetaInFlight()).toBeLessThanOrEqual(4);
    expect(result.events).toHaveLength(899);
    expect(result.events.some((event) => event.id === makeRow(5).id)).toBe(false);
    expect(result.events[0].data).toEqual({ page_ref: 'ref-0', title: 'Title ref-0' });
    expect(result.events[0].meta.cursor_color).toBe('#4a9a8a');
  });

  it('throws when a page metadata lookup fails instead of treating pages as untitled', async () => {
    fakeEventTables({
      events: { data: [navigationRow(0)], error: null },
      pageMeta: () => ({ data: null, error: { message: 'statement timeout' } }),
      participants: { data: [], error: null },
    });

    await expect(loadRecentEvents(env, ALL_NAVIGATION)).rejects.toThrow(
      'Page metadata lookup failed: statement timeout',
    );
  });

  it('returns a collection_events failure as an error result', async () => {
    fakeEventTables({
      events: { data: null, error: { message: 'connection refused' } },
      pageMeta: () => ({ data: [], error: null }),
      participants: { data: [], error: null },
    });

    await expect(loadRecentEvents(env, ALL_NAVIGATION)).resolves.toEqual({
      events: null,
      error: { message: 'connection refused' },
    });
  });

  it('sends the CORS header on both failure responses', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    fakeEventTables({
      events: { data: null, error: { message: 'connection refused' } },
      pageMeta: () => ({ data: [], error: null }),
      participants: { data: [], error: null },
    });
    const queryFailure = await handleRecent(
      new Request('https://worker.example/events/recent?type=navigation'),
      env,
    );
    expect(queryFailure.status).toBe(500);
    expect(queryFailure.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(error).toHaveBeenCalledWith('Supabase query error:', { message: 'connection refused' });

    fakeEventTables({
      events: { data: [navigationRow(0)], error: null },
      pageMeta: () => ({ data: null, error: { message: 'statement timeout' } }),
      participants: { data: [], error: null },
    });
    const lookupFailure = await handleRecent(
      new Request('https://worker.example/events/recent?type=navigation'),
      env,
    );
    expect(lookupFailure.status).toBe(500);
    expect(lookupFailure.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(error).toHaveBeenCalledWith('Recent events error:', expect.any(Error));
    error.mockRestore();
  });
});

describe('recent events for one page', () => {
  const env = {} as Env;
  const md5 = (text: string) => createHash('md5').update(text, 'utf8').digest('hex');

  /** Answers page_events_page from `rows` by md5(url) and its keyset arguments, recording every call. */
  function fakePageIndex(rows: Record<string, unknown>[]) {
    const rpcCalls: Array<[string, Record<string, unknown>]> = [];
    const tables: string[] = [];
    const client = {
      rpc: async (name: string, args: Record<string, unknown>) => {
        rpcCalls.push([name, args]);
        const hashes = args.p_url_hashes as string[];
        const beforeTs = (args.p_before_ts as string | undefined) ?? null;
        const beforeId = (args.p_before_id as string | undefined) ?? null;
        const data = rows
          .filter((row) => hashes.includes(md5(row.url as string)))
          .filter((row) => args.p_type === null || row.type === args.p_type)
          .filter((row) => {
            if (beforeTs === null) return true;
            const ts = row.ts as string;
            return ts < beforeTs || (ts === beforeTs && (row.id as string) < (beforeId as string));
          })
          .sort((a, b) =>
            (b.ts as string).localeCompare(a.ts as string) ||
            (b.id as string).localeCompare(a.id as string),
          )
          .slice(0, args.p_limit as number);
        return { data, error: null };
      },
      from(table: string) {
        tables.push(table);
        if (table !== 'participants') throw new Error(`unexpected table ${table}`);
        return { select: () => ({ in: async () => ({ data: [], error: null }) }) };
      },
    };
    createSupabaseClient.mockReturnValue(client);
    return { rpcCalls, tables };
  }

  const PAGE = 'https://en.wikipedia.org/wiki/Cat';
  const PAGE_HASHES = [md5(PAGE), md5(`${PAGE}/`)];

  it('parses 1-4 comma-separated md5 digests and nothing else', () => {
    expect(parseUrlHashes(PAGE_HASHES.join(','))).toEqual(PAGE_HASHES);
    expect(parseUrlHashes(`${PAGE_HASHES[0]},${PAGE_HASHES[0]}`)).toEqual([PAGE_HASHES[0]]);
    expect(parseUrlHashes('')).toBeNull();
    expect(parseUrlHashes(PAGE_HASHES[0].toUpperCase())).toBeNull();
    expect(parseUrlHashes(`${PAGE_HASHES[0]},`)).toBeNull();
    expect(parseUrlHashes(Array(5).fill(PAGE_HASHES[0]).join(','))).toBeNull();
    expect(parseUrlHashes(PAGE)).toBeNull();
  });

  it('lists the stored forms of a page URL', () => {
    expect(pageEventUrlVariants('https://en.wikipedia.org/wiki/Cat#History')).toEqual([
      'https://en.wikipedia.org/wiki/Cat',
      'https://en.wikipedia.org/wiki/Cat/',
    ]);
    expect(pageEventUrlVariants('https://www.youtube.com/watch?v=abc')).toEqual([
      'https://www.youtube.com/watch?v=abc',
      'https://www.youtube.com/watch/?v=abc',
      'https://www.youtube.com/watch',
      'https://www.youtube.com/watch/',
    ]);
    expect(pageEventUrlVariants('https://example.com')).toEqual(['https://example.com/']);
    expect(() => pageEventUrlVariants('file:///Users/me/page.html')).toThrow();
    expect(() => pageEventUrlVariants('not a url')).toThrow();
  });

  it('reads the page index by hash with no domain filter', async () => {
    const rows = [
      { ...makeRow(0), url: PAGE },
      { ...makeRow(1), url: `${PAGE}/` },
      { ...makeRow(2), url: 'https://en.wikipedia.org/wiki/Dog' },
    ];
    const { rpcCalls, tables } = fakePageIndex(rows);

    const result = await loadRecentEvents(env, {
      type: 'cursor',
      limit: 1000,
      domain: null,
      urlHashes: PAGE_HASHES,
      pid: null,
      from: '2026-01-01T00:00:00.000Z',
      to: null,
      requireTitle: false,
    });
    if (result.error) throw new Error(result.error.message);

    expect(result.events.map((event) => event.meta.url)).toEqual([PAGE, `${PAGE}/`]);
    expect(rpcCalls).toEqual([
      [
        'page_events_page',
        {
          p_url_hashes: PAGE_HASHES,
          p_type: 'cursor',
          p_from: '2026-01-01T00:00:00.000Z',
          p_to: null,
          p_limit: 1000,
        },
      ],
    ]);
    expect(tables).not.toContain('collection_events');
  });

  it('pages through the page index after the last row', async () => {
    const rows = Array.from({ length: 1500 }, (_, index) => ({ ...makeRow(index), url: PAGE }));
    const { rpcCalls } = fakePageIndex(rows);

    const result = await loadRecentEvents(env, {
      type: null,
      limit: 1200,
      domain: null,
      urlHashes: [md5(PAGE)],
      pid: null,
      from: null,
      to: null,
      requireTitle: false,
    });
    if (result.error) throw new Error(result.error.message);

    expect(result.events).toHaveLength(1200);
    expect(new Set(result.events.map((event) => event.id)).size).toBe(1200);
    expect(rpcCalls).toHaveLength(2);
    expect(rpcCalls[1][1]).toMatchObject({
      p_before_ts: makeRow(999).ts,
      p_before_id: makeRow(999).id,
      p_limit: 200,
    });
  });

  it('handles GET /events/recent?urlHash= through the page index', async () => {
    const { rpcCalls } = fakePageIndex([{ ...makeRow(0), url: PAGE }]);

    const response = await handleRecent(
      new Request(
        `https://worker.example/events/recent?type=cursor&limit=5000&urlHash=${PAGE_HASHES.join('%2C')}`,
      ),
      env,
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toHaveLength(1);
    expect(rpcCalls[0][1]).toMatchObject({ p_url_hashes: PAGE_HASHES, p_limit: 1000 });
  });

  it.each([
    [`urlHash=${md5(PAGE)}&domain=en.wikipedia.org`, 'urlHash cannot be combined with domain or pid'],
    [`urlHash=${md5(PAGE)}&pid=someone`, 'urlHash cannot be combined with domain or pid'],
    [`urlHash=${encodeURIComponent(PAGE)}`, 'Invalid urlHash (expected 1-4 comma-separated md5 hex digests)'],
    ['urlHash=', 'Invalid urlHash (expected 1-4 comma-separated md5 hex digests)'],
    [`urlHash=${Array(5).fill(md5(PAGE)).join(',')}`, 'Invalid urlHash (expected 1-4 comma-separated md5 hex digests)'],
  ])('answers 400 to %s', async (query, message) => {
    const { rpcCalls } = fakePageIndex([]);
    const response = await handleRecent(
      new Request(`https://worker.example/events/recent?${query}`),
      env,
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: message });
    expect(rpcCalls).toHaveLength(0);
  });
});
