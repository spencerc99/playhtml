// ABOUTME: Tests for the /quarantine/element-* route handlers (per-image tape).
// ABOUTME: Mocks Supabase and asserts validation, src normalization, bulk grouping, rip idempotency, and setness snapshot.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

interface FakeState {
  rows: any[];
  inserted: any | null;
  updated: any | null;
  countValue: number;
}
let fake: FakeState;

function makeBuilder() {
  const b: any = {
    _op: 'select' as 'select' | 'insert' | 'update',
    _filters: {} as Record<string, unknown>,
    _inFilter: null as { col: string; vals: unknown[] } | null,
    _payload: null as any,
    _head: false,
    from() { return b; },
    select(_cols?: string, opts?: { count?: string; head?: boolean }) {
      if (opts?.head) b._head = true;
      return b;
    },
    insert(payload: any) { b._op = 'insert'; b._payload = payload; return b; },
    update(payload: any) { b._op = 'update'; b._payload = payload; return b; },
    eq(col: string, val: unknown) { b._filters[col] = val; return b; },
    in(col: string, vals: unknown[]) { b._inFilter = { col, vals }; return b; },
    order() { return b; },
    single() { return b._resolveSingle(); },
    maybeSingle() { return Promise.resolve({ data: b._matching()[0] ?? null, error: null }); },
    _matching() {
      let rows = fake.rows.filter((r) =>
        Object.entries(b._filters).every(([k, v]) => r[k] === v),
      );
      if (b._inFilter) {
        rows = rows.filter((r) => b._inFilter!.vals.includes(r[b._inFilter!.col]));
      }
      return rows;
    },
    _resolveSingle() {
      if (b._op === 'insert') {
        fake.inserted = { id: 'new-id', created_at: 'now', rips: [], rips_required: null, ...b._payload };
        return Promise.resolve({ data: fake.inserted, error: null });
      }
      if (b._op === 'update') {
        const match = b._matching()[0];
        fake.updated = { ...match, ...b._payload };
        return Promise.resolve({ data: fake.updated, error: null });
      }
      return Promise.resolve({ data: b._matching()[0] ?? null, error: null });
    },
    then(resolve: (v: any) => void) {
      if (b._head) resolve({ data: null, error: null, count: fake.countValue });
      else resolve({ data: b._matching(), error: null });
    },
  };
  return b;
}

vi.mock('../lib/supabase', () => ({
  createSupabaseClient: vi.fn(() => makeBuilder()),
}));

import {
  handleQuarantineElementVerdict,
  handleQuarantineElementMark,
  handleQuarantineElementRip,
  __resetRateLimitForTests,
} from '../routes/quarantineElement';
import type { Env } from '../lib/supabase';

const ENV = {
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SECRET_KEY: 'k',
  ADMIN_KEY: 'a',
  RESEND_API_KEY: 'r',
  CODA_API_TOKEN: 'c',
  LIVE_EVENTS_HUB: {} as unknown,
} as unknown as Env;

function get(url: string, ip = '1.2.3.4'): Request {
  return new Request(url, { headers: { 'CF-Connecting-IP': ip } });
}
function post(path: string, body: unknown, ip = '1.2.3.4'): Request {
  return new Request(`https://api.example.com${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': ip },
    body: JSON.stringify(body),
  });
}

let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  fake = { rows: [], inserted: null, updated: null, countValue: 0 };
  consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  __resetRateLimitForTests();
});
afterEach(() => {
  expect(consoleErrorSpy).not.toHaveBeenCalled();
  consoleErrorSpy.mockRestore();
});

describe('GET /quarantine/element-verdict', () => {
  it('400s with no src', async () => {
    const res = await handleQuarantineElementVerdict(get('https://api.example.com/quarantine/element-verdict'), ENV);
    expect(res.status).toBe(400);
  });

  it('groups marks by src', async () => {
    fake.rows = [
      { id: 'm1', src: 'https://cdn.x.com/a.png?w=1', type: 'slop', seed: 1, created_by: 'p', created_at: 't', rips: [], rips_required: null },
      { id: 'm2', src: 'https://cdn.x.com/a.png?w=1', type: 'slop', seed: 2, created_by: 'q', created_at: 't', rips: [], rips_required: null },
      { id: 'm3', src: 'https://cdn.x.com/b.png', type: 'spam', seed: 3, created_by: 'r', created_at: 't', rips: [], rips_required: null },
    ];
    const url = 'https://api.example.com/quarantine/element-verdict?src=' +
      encodeURIComponent('https://cdn.x.com/a.png?w=1') + '&src=' +
      encodeURIComponent('https://cdn.x.com/b.png');
    const res = await handleQuarantineElementVerdict(get(url), ENV);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.marks['https://cdn.x.com/a.png?w=1']).toHaveLength(2);
    expect(body.marks['https://cdn.x.com/b.png']).toHaveLength(1);
  });
});

describe('POST /quarantine/element-mark', () => {
  it('400s on invalid type', async () => {
    const res = await handleQuarantineElementMark(
      post('/quarantine/element-mark', { src: 'https://x.com/i.png', type: 'nope', seed: 1, createdBy: 'p' }),
      ENV,
    );
    expect(res.status).toBe(400);
  });

  it('inserts a mark keyed by src with the query preserved', async () => {
    const res = await handleQuarantineElementMark(
      post('/quarantine/element-mark', { src: 'https://cdn.x.com/i.png?w=800&sig=abc#frag', type: 'slop', seed: 5, createdBy: 'pid1' }),
      ENV,
    );
    expect(res.status).toBe(200);
    expect(fake.inserted.src).toBe('https://cdn.x.com/i.png?w=800&sig=abc'); // hash dropped, query kept
    const body = (await res.json()) as any;
    expect(body.mark.type).toBe('slop');
  });
});

describe('POST /quarantine/element-rip', () => {
  const base = {
    id: 'em1', src: 'https://x.com/i.png', type: 'slop', seed: 1,
    created_by: 'author', created_at: 't', rips: [], rips_required: null,
  };

  it('404s when the mark is gone', async () => {
    const res = await handleQuarantineElementRip(
      post('/quarantine/element-rip', { src: 'https://x.com/i.png', markId: 'missing', by: 'p', pos: 0.5 }),
      ENV,
    );
    expect(res.status).toBe(404);
  });

  it('is idempotent per player', async () => {
    fake.rows = [{ ...base, rips: [{ by: 'p1', at: 1, pos: 0.5 }], rips_required: 1 }];
    const res = await handleQuarantineElementRip(
      post('/quarantine/element-rip', { src: 'https://x.com/i.png', markId: 'em1', by: 'p1', pos: 0.5 }),
      ENV,
    );
    expect(res.status).toBe(200);
    expect(fake.updated).toBeNull();
  });

  it('snapshots ripsRequired from the src mark count', async () => {
    fake.rows = [{ ...base }];
    fake.countValue = 4; // set
    await handleQuarantineElementRip(
      post('/quarantine/element-rip', { src: 'https://x.com/i.png', markId: 'em1', by: 'p1', pos: 0.5 }),
      ENV,
    );
    expect(fake.updated.rips_required).toBe(3);
  });
});
