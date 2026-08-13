// ABOUTME: Verifies public and guarded routes at the extension Worker boundary.
// ABOUTME: Covers headerless access to the sanitized Internet Commute response.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../lib/supabase';

const { handleCommute, handleCommuteReview } = vi.hoisted(() => ({
  handleCommute: vi.fn(
    async () =>
      new Response(JSON.stringify({ destinations: [] }), {
        headers: { 'Content-Type': 'application/json' },
      }),
  ),
  handleCommuteReview: vi.fn(
    async () =>
      new Response(JSON.stringify({ items: [] }), {
        headers: { 'Content-Type': 'application/json' },
      }),
  ),
}));

vi.mock('../routes/commute', () => ({
  handleCommute,
  handleCommuteReview,
}));

import worker from '../index';

describe('Worker route access', () => {
  beforeEach(() => {
    handleCommute.mockClear();
    handleCommuteReview.mockClear();
  });

  it('serves the commute review queue only to allowed browser origins', async () => {
    const allowed = await worker.fetch(
      new Request('https://worker.example/commute/review', {
        headers: { Origin: 'https://wewere.online' },
      }),
      {} as Env,
      {} as ExecutionContext,
    );
    const forbidden = await worker.fetch(
      new Request('https://worker.example/commute/review'),
      {} as Env,
      {} as ExecutionContext,
    );

    expect(allowed.status).toBe(200);
    expect(forbidden.status).toBe(403);
    expect(handleCommuteReview).toHaveBeenCalledTimes(1);
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
