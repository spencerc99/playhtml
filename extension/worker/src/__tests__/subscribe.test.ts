// ABOUTME: Tests for the POST /subscribe route handler.
// ABOUTME: Mocks the resend client and asserts validation, dedupe, and welcome-email behavior.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockAddContact = vi.fn();
const mockSendWelcome = vi.fn();

vi.mock('../lib/resend', () => ({
  createResendClient: vi.fn(() => ({
    addContact: mockAddContact,
    sendWelcomeEmail: mockSendWelcome,
  })),
}));

import { handleSubscribe, __resetRateLimitForTests } from '../routes/subscribe';
import type { Env } from '../lib/supabase';

const ENV: Env = {
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SECRET_KEY: 'k',
  ADMIN_KEY: 'a',
  RESEND_API_KEY: 'r',
};

function makeRequest(body: unknown, ip = '1.2.3.4'): Request {
  return new Request('https://example.com/subscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': ip },
    body: JSON.stringify(body),
  });
}

describe('handleSubscribe', () => {
  beforeEach(() => {
    mockAddContact.mockReset();
    mockSendWelcome.mockReset();
    __resetRateLimitForTests();
  });

  it('returns 400 for invalid email format', async () => {
    const res = await handleSubscribe(makeRequest({ email: 'nope', source: 'website' }), ENV);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toMatch(/email/i);
    expect(mockAddContact).not.toHaveBeenCalled();
  });

  it('returns 400 for missing source', async () => {
    const res = await handleSubscribe(makeRequest({ email: 'a@b.com' }), ENV);
    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid source value', async () => {
    const res = await handleSubscribe(
      makeRequest({ email: 'a@b.com', source: 'bogus' }),
      ENV,
    );
    expect(res.status).toBe(400);
  });

  it('on new contact: creates contact, sends welcome, returns alreadySubscribed=false', async () => {
    mockAddContact.mockResolvedValueOnce({ created: true });
    mockSendWelcome.mockResolvedValueOnce(undefined);

    const res = await handleSubscribe(
      makeRequest({ email: 'new@example.com', source: 'website' }),
      ENV,
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, alreadySubscribed: false });
    expect(mockAddContact).toHaveBeenCalledWith('new@example.com', 'website');
    expect(mockSendWelcome).toHaveBeenCalledWith('new@example.com');
  });

  it('on existing contact: skips welcome, returns alreadySubscribed=true', async () => {
    mockAddContact.mockResolvedValueOnce({ created: false });

    const res = await handleSubscribe(
      makeRequest({ email: 'existing@example.com', source: 'website' }),
      ENV,
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, alreadySubscribed: true });
    expect(mockSendWelcome).not.toHaveBeenCalled();
  });

  it('contact created but welcome send fails: still returns 200', async () => {
    mockAddContact.mockResolvedValueOnce({ created: true });
    mockSendWelcome.mockRejectedValueOnce(new Error('resend down'));

    const res = await handleSubscribe(
      makeRequest({ email: 'a@b.com', source: 'website' }),
      ENV,
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, alreadySubscribed: false });
  });

  it('on Resend addContact failure: returns 503', async () => {
    mockAddContact.mockRejectedValueOnce(new Error('resend down'));

    const res = await handleSubscribe(
      makeRequest({ email: 'a@b.com', source: 'website' }),
      ENV,
    );

    expect(res.status).toBe(503);
  });

  it('rate-limits after 5 requests from same IP within a minute', async () => {
    mockAddContact.mockResolvedValue({ created: true });
    mockSendWelcome.mockResolvedValue(undefined);

    const ip = '9.9.9.9';
    for (let i = 0; i < 5; i++) {
      const res = await handleSubscribe(
        makeRequest({ email: `a${i}@b.com`, source: 'website' }, ip),
        ENV,
      );
      expect(res.status).toBe(200);
    }

    const res = await handleSubscribe(
      makeRequest({ email: 'a6@b.com', source: 'website' }, ip),
      ENV,
    );
    expect(res.status).toBe(429);
  });

  it('CORS headers are present on success and error responses', async () => {
    mockAddContact.mockResolvedValueOnce({ created: true });
    mockSendWelcome.mockResolvedValueOnce(undefined);
    const ok = await handleSubscribe(
      makeRequest({ email: 'a@b.com', source: 'website' }),
      ENV,
    );
    expect(ok.headers.get('Access-Control-Allow-Origin')).toBe('*');

    const bad = await handleSubscribe(makeRequest({ email: 'nope' }), ENV);
    expect(bad.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });
});
