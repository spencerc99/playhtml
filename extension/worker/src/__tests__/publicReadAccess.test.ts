// ABOUTME: Verifies public reads accept an allowed origin or a participant-key signature.
// ABOUTME: Covers /events/recent access, bad and stale signatures, /page-meta staying origin-only, and the preflight.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../lib/supabase';
import { publicReadAccess } from '../lib/publicReadAccess';
import { bytesToHex } from '../../../src/utils/restoreRequest';
import {
  recentEventsHeaders,
  signRecentEventsRequest,
} from '../../../src/utils/recentEventsRequest';

const { handleRecent, handlePageMeta } = vi.hoisted(() => ({
  handleRecent: vi.fn(async () => new Response('[]', { status: 200 })),
  handlePageMeta: vi.fn(async () => new Response('{}', { status: 200 })),
}));

vi.mock('../routes/recent', () => ({ handleRecent }));
vi.mock('../routes/pageMeta', () => ({ handlePageMeta }));

import worker from '../index';

async function generateIdentity(): Promise<{ publicId: string; privateKey: JsonWebKey }> {
  const pair = (await crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign', 'verify'],
  )) as CryptoKeyPair;
  const raw = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
  return {
    publicId: `pk_${bytesToHex(raw)}`,
    privateKey: (await crypto.subtle.exportKey('jwk', pair.privateKey)) as JsonWebKey,
  };
}

async function signedHeaders(signedAt = Date.now()): Promise<Record<string, string>> {
  const { publicId, privateKey } = await generateIdentity();
  return recentEventsHeaders(
    await signRecentEventsRequest(privateKey, { publicId, signedAt }),
  );
}

function get(path: string, headers: Record<string, string> = {}): Promise<Response> {
  return worker.fetch(
    new Request(`https://worker.example${path}`, { headers }),
    {} as Env,
    {} as ExecutionContext,
  );
}

const ROUTES = ['/events/recent?type=cursor&limit=10&domain=example.com'];
const PAGE_META = '/page-meta?url=https%3A%2F%2Fexample.com%2F';

describe('public read access', () => {
  beforeEach(() => {
    handleRecent.mockClear();
    handlePageMeta.mockClear();
  });

  for (const path of ROUTES) {
    describe(path.split('?')[0], () => {
      it('answers an allowed origin without a signature', async () => {
        const response = await get(path, { Origin: 'https://wewere.online' });
        expect(response.status).toBe(200);
      });

      it('answers a request with no origin and a valid signature', async () => {
        const response = await get(path, await signedHeaders());
        expect(response.status).toBe(200);
      });

      it('refuses a request with no origin and no signature', async () => {
        const response = await get(path);
        expect(response.status).toBe(403);
      });

      it('refuses a request whose page origin is not allowed and is unsigned', async () => {
        const response = await get(path, { Origin: 'https://example.com' });
        expect(response.status).toBe(403);
      });

      it('rejects a signature that does not verify', async () => {
        const headers = await signedHeaders();
        const tampered = {
          ...headers,
          'X-WWO-Signed-At': String(Number(headers['X-WWO-Signed-At']) + 1),
        };
        const response = await get(path, tampered);
        expect(response.status).toBe(401);
      });

      it('rejects a stale signature', async () => {
        const response = await get(path, await signedHeaders(Date.now() - 6 * 60_000));
        expect(response.status).toBe(401);
      });
    });
  }

  it('keeps the route closed for a handler when access is refused', async () => {
    await get(ROUTES[0]);
    expect(handleRecent).not.toHaveBeenCalled();
  });

  it('keeps /page-meta origin-only: a valid signature without an allowed origin is refused', async () => {
    expect((await get(PAGE_META, await signedHeaders())).status).toBe(403);
    expect(handlePageMeta).not.toHaveBeenCalled();
    expect((await get(PAGE_META, { Origin: 'https://wewere.online' })).status).toBe(200);
  });

  it('allows the signed-read headers in the CORS preflight', async () => {
    const response = await worker.fetch(
      new Request('https://worker.example/events/recent', { method: 'OPTIONS' }),
      {} as Env,
      {} as ExecutionContext,
    );
    const allowed = (response.headers.get('Access-Control-Allow-Headers') ?? '')
      .split(',')
      .map((h) => h.trim().toLowerCase());
    expect(allowed).toEqual(
      expect.arrayContaining(['x-wwo-public-id', 'x-wwo-signed-at', 'x-wwo-signature']),
    );
    // Signed reads are GETs, so the preflight has to let that method through.
    expect(response.headers.get('Access-Control-Allow-Methods')).toContain('GET');
  });
});

describe('publicReadAccess', () => {
  const at = (headers: Record<string, string>) => ({ headers: new Headers(headers) });

  it('lets an allowed origin in even with signature headers that do not verify', async () => {
    const headers = await signedHeaders();
    expect(
      await publicReadAccess(
        at({ ...headers, 'X-WWO-Signature': '0'.repeat(128), Origin: 'https://playhtml.fun' }),
      ),
    ).toBe('origin');
  });

  it('reports a verified signature', async () => {
    expect(await publicReadAccess(at(await signedHeaders()))).toBe('signature');
  });

  it('rejects partial or malformed signature headers', async () => {
    const headers = await signedHeaders();
    const { 'X-WWO-Signature': _omit, ...withoutSignature } = headers;
    expect(await publicReadAccess(at(withoutSignature))).toBe('unauthorized');
    expect(await publicReadAccess(at({ ...headers, 'X-WWO-Public-Id': 'pk_nope' }))).toBe(
      'unauthorized',
    );
    expect(await publicReadAccess(at({ ...headers, 'X-WWO-Signed-At': '12.5' }))).toBe(
      'unauthorized',
    );
  });

  it('rejects a well-formed id that is not a key on the curve', async () => {
    const headers = await signedHeaders();
    expect(
      await publicReadAccess(at({ ...headers, 'X-WWO-Public-Id': `pk_04${'0'.repeat(128)}` })),
    ).toBe('unauthorized');
  });

  it('rejects a signature made by a different key', async () => {
    const mine = await signedHeaders();
    const other = await signedHeaders(Number(mine['X-WWO-Signed-At']));
    expect(
      await publicReadAccess(at({ ...mine, 'X-WWO-Signature': other['X-WWO-Signature'] })),
    ).toBe('unauthorized');
  });
});
