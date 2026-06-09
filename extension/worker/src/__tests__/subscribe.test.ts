// ABOUTME: Tests for the POST /subscribe route handler.
// ABOUTME: Mocks the resend client and asserts validation, dedupe, and signup-email behavior.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockAddContact = vi.fn();
const mockSendWelcome = vi.fn();
const mockSendUpdates = vi.fn();
let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
let allowConsoleError = false;

vi.mock('../lib/resend', () => ({
  createResendClient: vi.fn(() => ({
    addContact: mockAddContact,
    sendWelcomeEmail: mockSendWelcome,
    sendUpdatesEmail: mockSendUpdates,
  })),
}));

import { handleSubscribe, __resetRateLimitForTests } from '../routes/subscribe';
import type { Env } from '../lib/supabase';

const ENV: Env = {
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SECRET_KEY: 'k',
  ADMIN_KEY: 'a',
  RESEND_API_KEY: 'r',
  LIVE_EVENTS_HUB: {} as DurableObjectNamespace,
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
    mockSendUpdates.mockReset();
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    allowConsoleError = false;
    __resetRateLimitForTests();
  });

  afterEach(() => {
    if (!allowConsoleError) {
      expect(consoleErrorSpy).not.toHaveBeenCalled();
    }
    consoleErrorSpy.mockRestore();
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

  it('on existing contact: sends welcome, returns alreadySubscribed=true', async () => {
    mockAddContact.mockResolvedValueOnce({ created: false });
    mockSendWelcome.mockResolvedValueOnce(undefined);

    const res = await handleSubscribe(
      makeRequest({ email: 'existing@example.com', source: 'website' }),
      ENV,
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, alreadySubscribed: true });
    expect(mockSendWelcome).toHaveBeenCalledWith('existing@example.com');
  });

  it('on extension setup contact: adds contact and sends updates email', async () => {
    mockAddContact.mockResolvedValueOnce({ created: true });
    mockSendUpdates.mockResolvedValueOnce(undefined);

    const res = await handleSubscribe(
      makeRequest({ email: 'setup@example.com', source: 'extension-setup' }),
      ENV,
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, alreadySubscribed: false });
    expect(mockAddContact).toHaveBeenCalledWith('setup@example.com', 'extension-setup');
    expect(mockSendWelcome).not.toHaveBeenCalled();
    expect(mockSendUpdates).toHaveBeenCalledWith('setup@example.com');
  });

  it('returns 503 when welcome send fails', async () => {
    allowConsoleError = true;
    mockAddContact.mockResolvedValueOnce({ created: true });
    mockSendWelcome.mockRejectedValueOnce(new Error('resend down'));

    const res = await handleSubscribe(
      makeRequest({ email: 'a@b.com', source: 'website' }),
      ENV,
    );

    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'Email service temporarily unavailable' });
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      '[Subscribe] sendWelcomeEmail failed:',
      expect.any(Error),
    );
  });

  it('returns 503 when updates send fails', async () => {
    allowConsoleError = true;
    mockAddContact.mockResolvedValueOnce({ created: true });
    mockSendUpdates.mockRejectedValueOnce(new Error('resend down'));

    const res = await handleSubscribe(
      makeRequest({ email: 'a@b.com', source: 'extension-setup' }),
      ENV,
    );

    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'Email service temporarily unavailable' });
    expect(mockSendWelcome).not.toHaveBeenCalled();
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      '[Subscribe] sendUpdatesEmail failed:',
      expect.any(Error),
    );
  });

  it('on Resend addContact failure: returns 503', async () => {
    allowConsoleError = true;
    mockAddContact.mockRejectedValueOnce(new Error('resend down'));

    const res = await handleSubscribe(
      makeRequest({ email: 'a@b.com', source: 'website' }),
      ENV,
    );

    expect(res.status).toBe(503);
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      '[Subscribe] addContact failed:',
      expect.any(Error),
    );
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
