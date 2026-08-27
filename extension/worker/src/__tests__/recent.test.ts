// ABOUTME: Tests stable pagination for recent extension events.
// ABOUTME: Verifies live inserts cannot shift later pages onto duplicate rows.

import { describe, expect, it } from 'vitest';
import {
  getEarlierEventFilter,
  getRecentEventTypeFilter,
  loadRecentEventRows,
} from '../routes/recent';

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
