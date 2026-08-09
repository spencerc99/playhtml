// ABOUTME: Tests stable pagination for recent extension events.
// ABOUTME: Verifies live inserts cannot shift later pages onto duplicate rows.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../lib/supabase';

const collectionEvents = {
  select: vi.fn(),
  eq: vi.fn(),
  gte: vi.fn(),
  lte: vi.fn(),
  or: vi.fn(),
  order: vi.fn(),
  limit: vi.fn(),
  range: vi.fn(),
};

const participants = {
  select: vi.fn(),
  in: vi.fn(),
};

const from = vi.fn();
let offsetPages: Array<{ data: Array<Record<string, unknown>>; error: null }>;
let keysetPages: Array<{ data: Array<Record<string, unknown>>; error: null }>;

vi.mock('../lib/supabase', () => ({
  createSupabaseClient: vi.fn(() => ({ from })),
}));

import { handleRecent } from '../routes/recent';

const ENV: Env = {
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SECRET_KEY: 'k',
  ADMIN_KEY: 'a',
  RESEND_API_KEY: 'r',
  CODA_API_TOKEN: 'c',
  LIVE_EVENTS_HUB: {} as DurableObjectNamespace,
};

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

describe('handleRecent', () => {
  beforeEach(() => {
    Object.values(collectionEvents).forEach((mock) => mock.mockReset());
    Object.values(participants).forEach((mock) => mock.mockReset());
    from.mockReset();

    const firstPage = Array.from({ length: 1000 }, (_, index) => makeRow(index));
    offsetPages = [
      { data: firstPage, error: null },
      { data: [makeRow(999)], error: null },
    ];
    keysetPages = [
      { data: firstPage, error: null },
      { data: [makeRow(1000)], error: null },
    ];

    from.mockImplementation((table: string) => {
      if (table === 'collection_events') return collectionEvents;
      if (table === 'participants') return participants;
      throw new Error(`Unexpected table: ${table}`);
    });

    collectionEvents.select.mockReturnValue(collectionEvents);
    collectionEvents.eq.mockReturnValue(collectionEvents);
    collectionEvents.gte.mockReturnValue(collectionEvents);
    collectionEvents.lte.mockReturnValue(collectionEvents);
    collectionEvents.or.mockReturnValue(collectionEvents);
    collectionEvents.order.mockReturnValue(collectionEvents);
    collectionEvents.range.mockImplementation(() =>
      Promise.resolve(offsetPages.shift()),
    );
    collectionEvents.limit.mockImplementation(() =>
      Promise.resolve(keysetPages.shift()),
    );

    participants.select.mockReturnValue(participants);
    participants.in.mockResolvedValue({ data: [], error: null });
  });

  it('continues after the last row instead of using a shifted offset', async () => {
    const response = await handleRecent(
      new Request('https://worker.example/events/recent?limit=1001'),
      ENV,
    );

    expect(response.status).toBe(200);
    const events = await response.json() as Array<{ id: string }>;

    expect(events).toHaveLength(1001);
    expect(new Set(events.map((event) => event.id)).size).toBe(1001);
    expect(events.at(-1)?.id).toBe('event-1000');
    expect(collectionEvents.range).not.toHaveBeenCalled();
    expect(collectionEvents.order).toHaveBeenCalledWith('ts', { ascending: false });
    expect(collectionEvents.order).toHaveBeenCalledWith('id', { ascending: false });
    expect(collectionEvents.or).toHaveBeenCalledWith(
      'ts.lt."2026-01-01T23:43:21.000Z",and(ts.eq."2026-01-01T23:43:21.000Z",id.lt."event-0999")',
    );
  });
});
