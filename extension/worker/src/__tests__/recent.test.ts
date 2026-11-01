// ABOUTME: Tests stable pagination for recent extension events.
// ABOUTME: Verifies live inserts cannot shift later pages onto duplicate rows.

import { describe, expect, it, vi } from 'vitest';
import type { Env } from '../lib/supabase';

const { createSupabaseClient } = vi.hoisted(() => ({
  createSupabaseClient: vi.fn(),
}));

vi.mock('../lib/supabase', () => ({ createSupabaseClient }));

import {
  getEarlierEventFilter,
  getRecentEventTypeFilter,
  loadRecentEventRows,
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
