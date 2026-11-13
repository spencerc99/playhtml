// ABOUTME: Verifies /page-meta caches a failed lookup for five minutes instead of a day.
// ABOUTME: The edge cache write is deferred with ctx.waitUntil so it never delays the response.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { handlePageMeta } from '../routes/pageMeta';
import type { Env } from '../lib/supabase';

const cachePut = vi.fn(async () => {});
const backgroundWork: Promise<unknown>[] = [];
const ctx = {
  waitUntil: vi.fn((promise: Promise<unknown>) => {
    backgroundWork.push(promise);
  }),
} as unknown as ExecutionContext;

function lookup(url: string, ip: string): Request {
  return new Request(`https://worker.example/page-meta?url=${encodeURIComponent(url)}`, {
    headers: { 'CF-Connecting-IP': ip },
  });
}

describe('page meta caching', () => {
  beforeEach(() => {
    cachePut.mockClear();
    backgroundWork.length = 0;
    vi.stubGlobal('caches', {
      default: { match: vi.fn(async () => undefined), put: cachePut },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('caches a failed lookup for five minutes, after the response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new TypeError('network down');
    }));

    const response = await handlePageMeta(lookup('https://example.com/down', '203.0.113.1'), {} as Env, ctx);

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ source: 'none' });
    expect(response.headers.get('Cache-Control')).toBe('public, max-age=300, s-maxage=300');
    expect(ctx.waitUntil).toHaveBeenCalledTimes(1);
    await Promise.all(backgroundWork);
    expect(cachePut).toHaveBeenCalledTimes(1);
    const cached = (cachePut.mock.calls[0] as unknown as [Request, Response])[1];
    expect(cached.headers.get('Cache-Control')).toBe('public, max-age=300, s-maxage=300');
  });
});
