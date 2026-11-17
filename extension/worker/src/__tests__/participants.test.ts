// ABOUTME: Tests the signed cursor color contract for PUT /participants/:pid with real WebCrypto keys.
// ABOUTME: Covers enforced and legacy modes of REQUIRE_PARTICIPANT_SIGNATURES, and 4xx for malformed input.

import { beforeEach, describe, expect, it, vi } from 'vitest';

const upsert = vi.fn(async () => ({ error: null }));
vi.mock('../lib/supabase', () => ({
  createSupabaseClient: vi.fn(() => ({
    from: vi.fn((table: string) => {
      if (table !== 'participants') throw new Error(`Unexpected table: ${table}`);
      return { upsert };
    }),
  })),
}));

import {
  handleParticipantUpsert,
  verifyParticipantColorSignature,
} from '../routes/participants';
import { bytesToHex } from '../../../src/utils/restoreRequest';
import {
  PARTICIPANT_COLOR_SIGNATURE_MAX_AGE_MS,
  signParticipantColorRequest,
} from '../../../src/utils/participantColorRequest';
import type { Env } from '../lib/supabase';

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

const NOW = Date.UTC(2026, 10, 11, 12);

function putColor(pid: string, body: unknown): Request {
  return new Request(`https://worker.example/participants/${pid}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('participant color signatures', () => {
  it('accepts a color signed by the participant', async () => {
    const me = await makeIdentity();
    const request = await signParticipantColorRequest(me.privateKey, {
      pid: me.pid,
      color: '#4a9a8a',
      signedAt: NOW,
    });

    expect(await verifyParticipantColorSignature(request, NOW + 1_000)).toBe(true);
  });

  it('rejects a color signed by someone else', async () => {
    const me = await makeIdentity();
    const other = await makeIdentity();
    const request = await signParticipantColorRequest(other.privateKey, {
      pid: me.pid,
      color: '#4a9a8a',
      signedAt: NOW,
    });

    expect(await verifyParticipantColorSignature(request, NOW)).toBe(false);
  });

  it('rejects a signed request whose color was changed', async () => {
    const me = await makeIdentity();
    const request = await signParticipantColorRequest(me.privateKey, {
      pid: me.pid,
      color: '#4a9a8a',
      signedAt: NOW,
    });

    expect(
      await verifyParticipantColorSignature({ ...request, color: '#000000' }, NOW),
    ).toBe(false);
  });

  it('rejects a signature outside the freshness window', async () => {
    const me = await makeIdentity();
    const request = await signParticipantColorRequest(me.privateKey, {
      pid: me.pid,
      color: 'hsl(120, 70%, 60%)',
      signedAt: NOW,
    });

    expect(
      await verifyParticipantColorSignature(
        request,
        NOW + PARTICIPANT_COLOR_SIGNATURE_MAX_AGE_MS + 1,
      ),
    ).toBe(false);
  });
});

async function signedBody(privateKey: JsonWebKey, pid: string, color: string, signedAt = Date.now()) {
  const signed = await signParticipantColorRequest(privateKey, { pid, color, signedAt });
  return { cursor_color: color, signedAt: signed.signedAt, signature: signed.signature };
}

describe('PUT /participants/:pid', () => {
  const env = {} as Env;
  const legacyEnv = { REQUIRE_PARTICIPANT_SIGNATURES: 'false' } as Env;
  const enforcedEnv = { REQUIRE_PARTICIPANT_SIGNATURES: 'true' } as Env;

  beforeEach(() => {
    upsert.mockClear();
  });

  it('with enforcement on, answers 401 to an unsigned color update', async () => {
    const me = await makeIdentity();
    const response = await handleParticipantUpsert(
      putColor(me.pid, { cursor_color: '#4a9a8a' }),
      enforcedEnv,
      me.pid,
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'Missing signature' });
    expect(upsert).not.toHaveBeenCalled();
  });

  it.each([
    ['set to "false"', legacyEnv],
    ['unset', env],
  ])('with enforcement %s, saves an unsigned color and logs it as legacy', async (_label, modeEnv) => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const me = await makeIdentity();
    const response = await handleParticipantUpsert(
      putColor(me.pid, { cursor_color: '#4a9a8a' }),
      modeEnv,
      me.pid,
    );

    expect(response.status).toBe(200);
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ pid: me.pid, cursor_color: '#4a9a8a' }),
      { onConflict: 'pid' },
    );
    expect(log).toHaveBeenCalledWith('[legacy-unsigned] PUT /participants/:pid');
    log.mockRestore();
  });

  it.each([
    ['off', legacyEnv],
    ['on', enforcedEnv],
  ])('with enforcement %s, saves a color signed by the participant', async (_label, modeEnv) => {
    const me = await makeIdentity();
    const response = await handleParticipantUpsert(
      putColor(me.pid, await signedBody(me.privateKey, me.pid, '#4a9a8a')),
      modeEnv,
      me.pid,
    );

    expect(response.status).toBe(200);
    expect(upsert).toHaveBeenCalledTimes(1);
  });

  it('with enforcement off, still answers 401 to a stale signature', async () => {
    const me = await makeIdentity();
    const stale = Date.now() - PARTICIPANT_COLOR_SIGNATURE_MAX_AGE_MS - 60_000;
    const response = await handleParticipantUpsert(
      putColor(me.pid, await signedBody(me.privateKey, me.pid, '#4a9a8a', stale)),
      legacyEnv,
      me.pid,
    );

    expect(response.status).toBe(401);
    expect(upsert).not.toHaveBeenCalled();
  });

  it('with enforcement off, still answers 401 to a malformed signature', async () => {
    const me = await makeIdentity();
    const response = await handleParticipantUpsert(
      putColor(me.pid, { cursor_color: '#4a9a8a', signature: 'abc' }),
      legacyEnv,
      me.pid,
    );

    expect(response.status).toBe(401);
    expect(upsert).not.toHaveBeenCalled();
  });

  it('with enforcement off, answers 401 to a color signed by another key', async () => {
    const me = await makeIdentity();
    const other = await makeIdentity();
    const signed = await signParticipantColorRequest(other.privateKey, {
      pid: me.pid,
      color: '#4a9a8a',
      signedAt: Date.now(),
    });
    const response = await handleParticipantUpsert(
      putColor(me.pid, {
        cursor_color: signed.color,
        signedAt: signed.signedAt,
        signature: signed.signature,
      }),
      legacyEnv,
      me.pid,
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'Invalid signature' });
  });

  it.each([
    'pk_short',
    `pk_${'a'.repeat(130)}`,
    `pk_04${'A'.repeat(128)}`,
  ])('answers 400 to a pid that is not an identity key: %s', async (pid) => {
    const response = await handleParticipantUpsert(
      putColor(pid, { cursor_color: '#4a9a8a' }),
      env,
      pid,
    );

    expect(response.status).toBe(400);
  });

  it('answers 400 to a JSON null body', async () => {
    const me = await makeIdentity();
    const response = await handleParticipantUpsert(putColor(me.pid, null), env, me.pid);

    expect(response.status).toBe(400);
  });
});
