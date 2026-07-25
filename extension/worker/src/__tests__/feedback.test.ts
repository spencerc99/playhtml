// ABOUTME: Tests for the POST /feedback route handler.
// ABOUTME: Verifies validation, Coda row submission, errors, and rate limiting.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../lib/supabase';
import { __resetRateLimitForTests, handleFeedback } from '../routes/feedback';

const ENV = {
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SECRET_KEY: 'k',
  ADMIN_KEY: 'a',
  RESEND_API_KEY: 'r',
  CODA_API_TOKEN: 'coda-token',
  LIVE_EVENTS_HUB: {} as DurableObjectNamespace,
} as Env;

function makeRequest(body: unknown, ip = '1.2.3.4'): Request {
  return new Request('https://example.com/feedback', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': ip },
    body: JSON.stringify(body),
  });
}

describe('handleFeedback', () => {
  const fetchMock = vi.fn();
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  let allowConsoleError = false;

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    allowConsoleError = false;
    __resetRateLimitForTests();
  });

  afterEach(() => {
    if (!allowConsoleError) {
      expect(consoleErrorSpy).not.toHaveBeenCalled();
    }
    consoleErrorSpy.mockRestore();
    vi.unstubAllGlobals();
  });

  it('submits a new triage row through the Coda API', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ requestId: 'request-1' }), { status: 202 }),
    );

    const response = await handleFeedback(
      makeRequest({
        message: '  The portrait is blank after reopening Chrome.  ',
        extensionVersion: '0.1.19',
        browser: 'Mozilla/5.0 Test Browser',
      }),
      ENV,
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(fetchMock).toHaveBeenCalledWith(
      'https://coda.io/apis/v1/docs/_zKy9BTw1m/tables/grid-wsf3jOpRC3/rows',
      {
        method: 'POST',
        headers: {
          Authorization: 'Bearer coda-token',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          rows: [
            {
              cells: [
                { column: 'c-pXnSC1ZoEI', value: 'The portrait is blank after reopening Chrome.' },
                { column: 'c-rHstNuQ2MN', value: 'New' },
                { column: 'c-nnuwiW7Ue4', value: 'Untriaged' },
                { column: 'c-Pz-CBsMdC_', value: '0.1.19' },
                { column: 'c-sb6OLuDn_A', value: 'Mozilla/5.0 Test Browser' },
                { column: 'c-DL0lexYSPt', value: 'extension-popup' },
              ],
            },
          ],
        }),
      },
    );
  });

  it('rejects empty feedback', async () => {
    const response = await handleFeedback(makeRequest({ message: '   ' }), ENV);

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'Feedback is required' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects a null JSON body', async () => {
    const response = await handleFeedback(makeRequest(null), ENV);

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'Invalid JSON body' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects feedback over 4000 characters', async () => {
    const response = await handleFeedback(
      makeRequest({ message: 'x'.repeat(4001) }),
      ENV,
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'Feedback is too long' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns 503 when Coda rejects the row', async () => {
    allowConsoleError = true;
    fetchMock.mockResolvedValueOnce(new Response('unauthorized', { status: 401 }));

    const response = await handleFeedback(
      makeRequest({ message: 'Something broke' }),
      ENV,
    );

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'Feedback service temporarily unavailable' });
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      '[Feedback] Coda submission failed:',
      expect.any(Error),
    );
  });

  it('rate-limits after 5 requests from one IP within a minute', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ requestId: 'request-1' }), { status: 202 }),
    );

    for (let i = 0; i < 5; i++) {
      const response = await handleFeedback(
        makeRequest({ message: `Feedback ${i}` }, '9.9.9.9'),
        ENV,
      );
      expect(response.status).toBe(200);
    }

    const response = await handleFeedback(
      makeRequest({ message: 'One too many' }, '9.9.9.9'),
      ENV,
    );

    expect(response.status).toBe(429);
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });
});
