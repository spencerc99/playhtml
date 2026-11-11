// ABOUTME: Tests stable pagination for recent extension events.
// ABOUTME: Verifies live inserts cannot shift later pages onto duplicate rows.

import { describe, expect, it, vi } from 'vitest';
import type { Env } from '../lib/supabase';

const { createSupabaseClient } = vi.hoisted(() => ({
  createSupabaseClient: vi.fn(),
}));

vi.mock('../lib/supabase', () => ({ createSupabaseClient }));

import { getEarlierEventFilter } from '../lib/eventCursorFilter';
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
