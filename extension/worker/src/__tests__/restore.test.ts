// ABOUTME: Tests the signed restore request contract with real WebCrypto keys.
// ABOUTME: Verifies only the identity key's holder can read a participant's history.

import { describe, expect, it } from 'vitest';
import { parseRestorePageRequest, verifyRestoreSignature } from '../routes/restore';
import {
  RESTORE_SIGNATURE_MAX_AGE_MS,
  bytesToHex,
  signRestorePageRequest,
} from '../../../src/utils/restoreRequest';

async function makeIdentity() {
  const keypair = await crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign', 'verify'],
  );
  const raw = new Uint8Array(await crypto.subtle.exportKey('raw', keypair.publicKey));
  return {
    pid: `pk_${bytesToHex(raw)}`,
    privateKey: await crypto.subtle.exportKey('jwk', keypair.privateKey),
  };
}

const NOW = Date.UTC(2026, 9, 29, 12);

describe('restore request signatures', () => {
  it('accepts a request signed by the participant', async () => {
    const me = await makeIdentity();
    const request = await signRestorePageRequest(me.privateKey, {
      pid: me.pid,
      type: 'cursor',
      before: { ts: '2026-10-20T10:00:00.123+00:00', id: 'evt-1' },
      signedAt: NOW,
    });

    expect(parseRestorePageRequest(JSON.parse(JSON.stringify(request)))).toEqual(request);
    expect(await verifyRestoreSignature(request, NOW + 1_000)).toBe(true);
  });

  it('rejects a request signed by someone else', async () => {
    const me = await makeIdentity();
    const other = await makeIdentity();
    const request = await signRestorePageRequest(other.privateKey, {
      pid: me.pid,
      type: 'cursor',
      before: null,
      signedAt: NOW,
    });

    expect(await verifyRestoreSignature(request, NOW)).toBe(false);
  });

  it('rejects a signed request whose page or type was changed', async () => {
    const me = await makeIdentity();
    const request = await signRestorePageRequest(me.privateKey, {
      pid: me.pid,
      type: 'cursor',
      before: null,
      signedAt: NOW,
    });

    expect(await verifyRestoreSignature({ ...request, type: 'keyboard' }, NOW)).toBe(false);
    expect(
      await verifyRestoreSignature(
        { ...request, before: { ts: '2026-01-01T00:00:00Z', id: 'x' } },
        NOW,
      ),
    ).toBe(false);
  });

  it('rejects stale signatures', async () => {
    const me = await makeIdentity();
    const request = await signRestorePageRequest(me.privateKey, {
      pid: me.pid,
      type: 'navigation',
      before: null,
      signedAt: NOW,
    });

    expect(await verifyRestoreSignature(request, NOW + RESTORE_SIGNATURE_MAX_AGE_MS + 1)).toBe(
      false,
    );
  });

  it('rejects malformed requests before checking signatures', async () => {
    const me = await makeIdentity();
    const request = await signRestorePageRequest(me.privateKey, {
      pid: me.pid,
      type: 'cursor',
      before: null,
      signedAt: NOW,
    });

    expect(parseRestorePageRequest({ ...request, pid: 'pk_short' })).toBeNull();
    expect(parseRestorePageRequest({ ...request, type: 'all' })).toBeNull();
    expect(parseRestorePageRequest({ ...request, signature: 'zz' })).toBeNull();
    expect(parseRestorePageRequest({ ...request, before: { ts: 'yesterday', id: 'a' } })).toBeNull();
    expect(parseRestorePageRequest({ ...request, before: undefined })).toBeNull();
  });
});
