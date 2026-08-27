// ABOUTME: Covers the public Internet Commute boarding request boundary.
// ABOUTME: Rejects malformed rider tokens, destination URLs, and non-domain claims.

import { describe, expect, it, vi } from 'vitest';
import type { Env } from '../lib/supabase';
import {
  handleCommuteTrainBoard,
  parseCommuteTrainBoardRequest,
} from '../routes/commuteTrains';

function rateLimitEnv(
  limit: RateLimit['limit'],
): Env {
  return {
    COMMUTE_BOARD_RATE_LIMITER: { limit },
  } as Env;
}

describe('parseCommuteTrainBoardRequest', () => {
  it('accepts standard and private riders without a shared stop', () => {
    expect(
      parseCommuteTrainBoardRequest({
        riderToken: 'rider_token_1234567890',
        requestedStop: { kind: 'none' },
      }),
    ).toEqual({
      riderToken: 'rider_token_1234567890',
      requestedStop: { kind: 'none' },
    });
  });

  it('accepts a normalized registrable domain', () => {
    expect(
      parseCommuteTrainBoardRequest({
        riderToken: 'rider_token_1234567890',
        requestedStop: { kind: 'domain', domain: 'example.co.uk' },
      }),
    ).toEqual({
      riderToken: 'rider_token_1234567890',
      requestedStop: { kind: 'domain', domain: 'example.co.uk' },
    });
  });

  it.each([
    'https://example.com/private',
    'www.example.com',
    'Example.com',
    'localhost',
  ])('rejects a non-canonical domain claim: %s', (domain) => {
    expect(
      parseCommuteTrainBoardRequest({
        riderToken: 'rider_token_1234567890',
        requestedStop: { kind: 'domain', domain },
      }),
    ).toBeNull();
  });

  it('rejects short or missing idempotency tokens', () => {
    expect(
      parseCommuteTrainBoardRequest({
        riderToken: 'short',
        requestedStop: { kind: 'none' },
      }),
    ).toBeNull();
  });
});

describe('handleCommuteTrainBoard', () => {
  it('rejects rate-limited requests before dispatching', async () => {
    const response = await handleCommuteTrainBoard(
      new Request('https://wewere.online/api/commute/trains/board', {
        method: 'POST',
        headers: { 'CF-Connecting-IP': '198.51.100.10' },
      }),
      rateLimitEnv(async ({ key }) => ({ success: key !== '198.51.100.10' })),
    );

    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBe('60');
    await expect(response.json()).resolves.toEqual({
      error: 'Too many boarding requests',
    });
  });

  it('fails closed when the rate-limit binding is unavailable', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const response = await handleCommuteTrainBoard(
      new Request('https://wewere.online/api/commute/trains/board', {
        method: 'POST',
      }),
      rateLimitEnv(async () => {
        throw new Error('binding unavailable');
      }),
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: 'Boarding is temporarily unavailable',
    });
    expect(consoleError).toHaveBeenCalledWith(
      '[commute trains] rate limiter unavailable:',
      expect.objectContaining({ message: 'binding unavailable' }),
    );
    consoleError.mockRestore();
  });
});
