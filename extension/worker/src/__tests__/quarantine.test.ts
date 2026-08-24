// ABOUTME: Tests for the /quarantine/* route handlers.
// ABOUTME: Mocks the Supabase client and asserts validation, url normalization, rip idempotency, and setness snapshot.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// --- fake Supabase query builder --------------------------------------------
// Each test seeds `store` (rows) + captures inserts/updates so we can assert on
// the handler logic without a real database.
interface FakeState {
  rows: any[];
  inserted: any | null;
  updated: any | null;
  countValue: number;
}
let fake: FakeState;

function makeBuilder() {
  // A chainable stub. Terminal awaits resolve to { data, error, count }.
  const b: any = {
    _op: 'select' as 'select' | 'insert' | 'update',
    _filters: {} as Record<string, unknown>,
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
    order() { return b; },
    single() { return b._resolveSingle(); },
    maybeSingle() { return b._resolveMaybeSingle(); },
    _matching() {
      return fake.rows.filter((r) =>
        Object.entries(b._filters).every(([k, v]) => r[k] === v),
      );
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
    _resolveMaybeSingle() {
      return Promise.resolve({ data: b._matching()[0] ?? null, error: null });
    },
    then(resolve: (v: any) => void) {
      // terminal await on a select (list) or head-count query
      if (b._head) {
        resolve({ data: null, error: null, count: fake.countValue });
      } else {
        resolve({ data: b._matching(), error: null });
      }
    },
  };
  return b;
}

vi.mock('../lib/supabase', () => ({
  createSupabaseClient: vi.fn(() => makeBuilder()),
}));

import {
  handleQuarantineVerdict,
  handleQuarantineStrip,
  handleQuarantineRip,
  __resetRateLimitForTests,
} from '../routes/quarantine';
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

const EDGE_A = { wall: 'left', t: 0.5 };
const EDGE_B = { wall: 'right', t: 0.5 };

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

describe('GET /quarantine/verdict', () => {
  it('400s on missing url', async () => {
    const res = await handleQuarantineVerdict(get('https://api.example.com/quarantine/verdict'), ENV);
    expect(res.status).toBe(400);
  });

  it('returns strips for a url as DTOs', async () => {
    fake.rows = [{
      id: 's1', url: 'https://x.com/page', type: 'slop',
      a_wall: 'left', a_t: 0.2, b_wall: 'right', b_t: 0.8,
      seed: 42, created_by: 'pid1', created_at: 't', rips: [], rips_required: null,
    }];
    const res = await handleQuarantineVerdict(
      get('https://api.example.com/quarantine/verdict?url=' + encodeURIComponent('https://x.com/page')),
      ENV,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.strips).toHaveLength(1);
    expect(body.strips[0]).toMatchObject({
      id: 's1', type: 'slop', a: { wall: 'left', t: 0.2 }, b: { wall: 'right', t: 0.8 },
    });
  });
});

describe('POST /quarantine/strip', () => {
  it('400s on invalid type', async () => {
    const res = await handleQuarantineStrip(
      post('/quarantine/strip', { url: 'https://x.com', type: 'nope', a: EDGE_A, b: EDGE_B, seed: 1, createdBy: 'p' }),
      ENV,
    );
    expect(res.status).toBe(400);
  });

  it('400s on out-of-range edge t', async () => {
    const res = await handleQuarantineStrip(
      post('/quarantine/strip', { url: 'https://x.com', type: 'slop', a: { wall: 'left', t: 5 }, b: EDGE_B, seed: 1, createdBy: 'p' }),
      ENV,
    );
    expect(res.status).toBe(400);
  });

  it('400s on missing createdBy', async () => {
    const res = await handleQuarantineStrip(
      post('/quarantine/strip', { url: 'https://x.com', type: 'slop', a: EDGE_A, b: EDGE_B, seed: 1 }),
      ENV,
    );
    expect(res.status).toBe(400);
  });

  it('inserts a strip and returns it', async () => {
    const res = await handleQuarantineStrip(
      post('/quarantine/strip', { url: 'https://x.com/p', type: 'spam', a: EDGE_A, b: EDGE_B, seed: 7, createdBy: 'pid9' }),
      ENV,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.strip.type).toBe('spam');
    expect(body.strip.createdBy).toBe('pid9');
    expect(fake.inserted.created_by).toBe('pid9');
  });

  it('keeps the query string in the url key (artifact identity)', async () => {
    await handleQuarantineStrip(
      post('/quarantine/strip', { url: 'https://cdn.x.com/img.png?w=800&sig=abc#frag', type: 'slop', a: EDGE_A, b: EDGE_B, seed: 1, createdBy: 'p' }),
      ENV,
    );
    // hash dropped, query kept
    expect(fake.inserted.url).toBe('https://cdn.x.com/img.png?w=800&sig=abc');
  });
});

describe('POST /quarantine/rip', () => {
  const baseStrip = {
    id: 'r1', url: 'https://x.com/p', type: 'slop',
    a_wall: 'left', a_t: 0.5, b_wall: 'right', b_t: 0.5,
    seed: 1, created_by: 'author', created_at: 't', rips: [], rips_required: null,
  };

  it('404s when the strip is gone', async () => {
    fake.rows = [];
    const res = await handleQuarantineRip(
      post('/quarantine/rip', { url: 'https://x.com/p', stripId: 'missing', by: 'p', pos: 0.5 }),
      ENV,
    );
    expect(res.status).toBe(404);
  });

  it('is idempotent per player — a second rip by the same pid is a no-op', async () => {
    fake.rows = [{ ...baseStrip, rips: [{ by: 'p1', at: 1, pos: 0.5 }], rips_required: 1 }];
    const res = await handleQuarantineRip(
      post('/quarantine/rip', { url: 'https://x.com/p', stripId: 'r1', by: 'p1', pos: 0.5 }),
      ENV,
    );
    expect(res.status).toBe(200);
    expect(fake.updated).toBeNull(); // no update written
  });

  it('snapshots ripsRequired=1 when the page is provisional (<3 strips)', async () => {
    fake.rows = [{ ...baseStrip }];
    fake.countValue = 2; // provisional
    await handleQuarantineRip(
      post('/quarantine/rip', { url: 'https://x.com/p', stripId: 'r1', by: 'p1', pos: 0.5 }),
      ENV,
    );
    expect(fake.updated.rips_required).toBe(1);
    expect(fake.updated.rips).toHaveLength(1);
  });

  it('snapshots ripsRequired=SET_THRESHOLD when the page is set (>=3 strips)', async () => {
    fake.rows = [{ ...baseStrip }];
    fake.countValue = 4; // set
    await handleQuarantineRip(
      post('/quarantine/rip', { url: 'https://x.com/p', stripId: 'r1', by: 'p1', pos: 0.5 }),
      ENV,
    );
    expect(fake.updated.rips_required).toBe(3);
  });

  it('does not recompute ripsRequired once snapshotted', async () => {
    fake.rows = [{ ...baseStrip, rips: [{ by: 'x', at: 1, pos: 0.5 }], rips_required: 3 }];
    fake.countValue = 1; // even though page is now provisional
    await handleQuarantineRip(
      post('/quarantine/rip', { url: 'https://x.com/p', stripId: 'r1', by: 'p2', pos: 0.5 }),
      ENV,
    );
    expect(fake.updated.rips_required).toBe(3); // unchanged
    expect(fake.updated.rips).toHaveLength(2);
  });
});
