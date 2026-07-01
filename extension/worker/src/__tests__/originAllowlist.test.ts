// ABOUTME: Tests for the origin allowlist guard used on public read endpoints.
// ABOUTME: Verifies allowed origins pass, others are rejected, and dev localhost works.

import { describe, it, expect } from 'vitest';
import { isAllowedOrigin } from '../lib/originAllowlist';

function req(headers: Record<string, string>): Request {
  return new Request('https://playhtml-game-api.spencerc99.workers.dev/events/recent', {
    headers,
  });
}

describe('isAllowedOrigin', () => {
  it('allows the production origin', () => {
    expect(isAllowedOrigin(req({ Origin: 'https://wewere.online' }))).toBe(true);
    expect(isAllowedOrigin(req({ Origin: 'https://www.wewere.online' }))).toBe(true);
  });

  it('allows localhost dev origins on any port', () => {
    expect(isAllowedOrigin(req({ Origin: 'http://localhost:5173' }))).toBe(true);
    expect(isAllowedOrigin(req({ Origin: 'http://127.0.0.1:3000' }))).toBe(true);
  });

  it('falls back to Referer when Origin is absent', () => {
    expect(isAllowedOrigin(req({ Referer: 'https://wewere.online/portrait' }))).toBe(true);
  });

  it('rejects an unknown origin', () => {
    expect(isAllowedOrigin(req({ Origin: 'https://evil.example.com' }))).toBe(false);
  });

  it('rejects a request with no Origin and no Referer', () => {
    expect(isAllowedOrigin(req({}))).toBe(false);
  });
});
