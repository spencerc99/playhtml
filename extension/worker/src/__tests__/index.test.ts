// ABOUTME: Verifies public and guarded routes at the extension Worker boundary.
// ABOUTME: Covers headerless access to the sanitized Internet Commute response.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../lib/supabase';

const { handleCommute } = vi.hoisted(() => ({
  handleCommute: vi.fn(
    async () =>
      new Response(JSON.stringify({ destinations: [] }), {
        headers: { 'Content-Type': 'application/json' },
      }),
  ),
}));

vi.mock('../routes/commute', () => ({
  handleCommute,
}));

import worker from '../index';

describe('Worker route access', () => {
  beforeEach(() => {
    handleCommute.mockClear();
  });

  it('serves the sanitized commute route without browser origin headers', async () => {
    const response = await worker.fetch(
      new Request('https://worker.example/commute/recent'),
      {} as Env,
      {} as ExecutionContext,
    );

    expect(response.status).toBe(200);
    expect(handleCommute).toHaveBeenCalledTimes(1);
  });

  it('keeps raw recent events unavailable without browser origin headers', async () => {
    const response = await worker.fetch(
      new Request('https://worker.example/events/recent'),
      {} as Env,
      {} as ExecutionContext,
    );

    expect(response.status).toBe(403);
    expect(handleCommute).not.toHaveBeenCalled();
  });
});
