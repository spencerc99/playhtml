// ABOUTME: Tests stable pagination for admin event exports.
// ABOUTME: Verifies delayed inserts cannot shift later pages onto duplicate rows.

import { describe, expect, it } from 'vitest';
import {
  getLaterEventFilter,
  loadExportEventRows,
} from '../routes/export';

interface StoredEventRow {
  id: string;
  type: 'keyboard';
  ts: string;
  data: unknown;
  participant_id: string;
  session_id: string;
  url: string;
  viewport_width: number;
  viewport_height: number;
  timezone: string;
}

const EVENT_TS = '2026-01-01T12:00:00.000Z';

function makeRow(index: number): StoredEventRow {
  return {
    id: `event-${index.toString().padStart(4, '0')}`,
    type: 'keyboard',
    ts: EVENT_TS,
    data: { event: 'type', index },
    participant_id: `participant-${index % 2}`,
    session_id: `session-${index}`,
    url: `https://example.com/${index}`,
    viewport_width: 1024,
    viewport_height: 768,
    timezone: 'America/Los_Angeles',
  };
}

describe('event export pagination', () => {
  it('continues after the last event when earlier rows arrive during export', async () => {
    const storedRows = Array.from({ length: 1001 }, (_, index) => makeRow(index));
    let pageCount = 0;

    const result = await loadExportEventRows(async (cursor, pageSize) => {
      pageCount += 1;
      if (pageCount === 2) {
        storedRows.push({
          ...makeRow(-1),
          id: 'event--delayed',
        });
      }

      const rows = storedRows
        .filter((row) => {
          if (!cursor) return true;
          return row.ts > cursor.ts || (row.ts === cursor.ts && row.id > cursor.id);
        })
        .sort((a, b) => {
          const tsOrder = a.ts.localeCompare(b.ts);
          return tsOrder || a.id.localeCompare(b.id);
        })
        .slice(0, pageSize);

      return { data: rows, error: null };
    });

    if (result.error) throw new Error(result.error.message);

    expect(result.rows).toHaveLength(1001);
    expect(new Set(result.rows.map((row) => row.id)).size).toBe(1001);
    expect(result.rows[0].id).toBe('event-0000');
    expect(result.rows[1000].id).toBe('event-1000');
    expect(result.rows.some((row) => row.id === 'event--delayed')).toBe(false);
  });

  it('builds a stable filter for equal timestamps and quoted ids', () => {
    expect(
      getLaterEventFilter(
        '2026-01-01T12:00:00.000Z',
        'event-"0999"',
      ),
    ).toBe(
      'ts.gt."2026-01-01T12:00:00.000Z",and(ts.eq."2026-01-01T12:00:00.000Z",id.gt."event-\\"0999\\"")',
    );
  });
});
