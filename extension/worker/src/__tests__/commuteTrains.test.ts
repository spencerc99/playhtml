// ABOUTME: Covers the public Internet Commute boarding request boundary.
// ABOUTME: Rejects malformed rider tokens, destination URLs, and non-domain claims.

import { describe, expect, it } from 'vitest';
import { parseCommuteTrainBoardRequest } from '../routes/commuteTrains';

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
