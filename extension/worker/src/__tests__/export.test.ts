// ABOUTME: Tests for the admin event export route.
// ABOUTME: Verifies auth, pagination, and JSON export shape for collected events.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../lib/supabase';

const queryBuilder = {
  select: vi.fn(),
  eq: vi.fn(),
  gte: vi.fn(),
  lt: vi.fn(),
  order: vi.fn(),
  range: vi.fn(),
  then: vi.fn(),
};

const from = vi.fn();
let pageResults: Array<{
  data: Array<Record<string, unknown>>;
  error: null;
  count: number;
}>;

vi.mock('../lib/supabase', () => ({
  createSupabaseClient: vi.fn(() => ({
    from,
  })),
}));

import { handleExport } from '../routes/export';

const ENV: Env = {
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SECRET_KEY: 'k',
  ADMIN_KEY: 'admin',
  RESEND_API_KEY: 'r',
  CODA_API_TOKEN: 'c',
  LIVE_EVENTS_HUB: {} as DurableObjectNamespace,
};

function makeExportRequest(): Request {
  return new Request('https://example.com/events/export', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer admin',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      type: 'keyboard',
      startDate: '2026-01-01T00:00:00.000Z',
      endDate: '2026-01-02T00:00:00.000Z',
      name: 'Keyboard Export',
    }),
  });
}

function makeRow(index: number): Record<string, unknown> {
  return {
    id: `event-${index}`,
    type: 'keyboard',
    ts: new Date(index).toISOString(),
    data: { event: 'type', index },
    participant_id: `participant-${index % 2}`,
    session_id: `session-${index}`,
    url: `https://example.com/${index}`,
    viewport_width: 1024,
    viewport_height: 768,
    timezone: 'America/Los_Angeles',
  };
}

describe('handleExport', () => {
  beforeEach(() => {
    queryBuilder.select.mockReset();
    queryBuilder.eq.mockReset();
    queryBuilder.gte.mockReset();
    queryBuilder.lt.mockReset();
    queryBuilder.order.mockReset();
    queryBuilder.range.mockReset();
    queryBuilder.then.mockReset();
    from.mockReset();

    pageResults = [
      {
        data: Array.from({ length: 1000 }, (_, index) => makeRow(index)),
        error: null,
        count: 1001,
      },
      {
        data: [makeRow(1000)],
        error: null,
        count: 1001,
      },
    ];

    from.mockReturnValue(queryBuilder);
    queryBuilder.select.mockReturnValue(queryBuilder);
    queryBuilder.eq.mockReturnValue(queryBuilder);
    queryBuilder.gte.mockReturnValue(queryBuilder);
    queryBuilder.lt.mockReturnValue(queryBuilder);
    queryBuilder.order.mockReturnValue(queryBuilder);
    queryBuilder.range.mockImplementation(() => Promise.resolve(pageResults.shift()));
    queryBuilder.then.mockImplementation((resolve, reject) =>
      Promise.resolve(pageResults[0]).then(resolve, reject),
    );
  });

  it('exports every matching event across Supabase result pages', async () => {
    const res = await handleExport(makeExportRequest(), ENV);

    expect(res.status).toBe(200);
    expect(queryBuilder.range).toHaveBeenCalledWith(0, 999);
    expect(queryBuilder.range).toHaveBeenCalledWith(1000, 1999);

    const body = await res.json() as {
      edition: { eventCount: number; participantCount: number };
      events: Array<{ id: string; ts: number }>;
    };

    expect(body.edition.eventCount).toBe(1001);
    expect(body.edition.participantCount).toBe(2);
    expect(body.events).toHaveLength(1001);
    expect(body.events[0]).toMatchObject({ id: 'event-0', ts: 0 });
    expect(body.events[1000]).toMatchObject({ id: 'event-1000', ts: 1000 });
  });
});
