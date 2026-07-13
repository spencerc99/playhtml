// ABOUTME: Verifies signed participant color updates at the Worker persistence boundary.
// ABOUTME: Covers proof verification and replay-safe monotonic color updates.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../lib/supabase';

const rpc = vi.fn();

vi.mock('../lib/supabase', () => ({
  createSupabaseClient: vi.fn(() => ({ rpc })),
}));

import { handleParticipantUpsert } from '../routes/participants';
import { participantColorUpdatePayload } from '../lib/participantProof';

const ENV: Env = {
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SECRET_KEY: 'k',
  ADMIN_KEY: 'a',
  RESEND_API_KEY: 'r',
  LIVE_EVENTS_HUB: {} as DurableObjectNamespace,
};

function toBase64(bytes: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)));
}

async function createSignedUpdate(color: string, version: number) {
  const keypair = await crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign', 'verify'],
  );
  const publicKey = new Uint8Array(await crypto.subtle.exportKey('raw', keypair.publicKey));
  const pid = `pk_${Array.from(publicKey, (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    keypair.privateKey,
    new TextEncoder().encode(participantColorUpdatePayload(pid, color, version)),
  );

  return { pid, color, version, signature: toBase64(signature) };
}

function makeRequest(body: unknown): Request {
  return new Request('https://example.com/participants/pk_test', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('handleParticipantUpsert', () => {
  beforeEach(() => {
    rpc.mockReset();
    rpc.mockResolvedValue({ data: true, error: null });
  });

  it('accepts a real P-256 proof for the exact participant color update', async () => {
    const update = await createSignedUpdate('#4a9a8a', 1);

    const response = await handleParticipantUpsert(makeRequest({
      cursor_color: update.color,
      version: update.version,
      signature: update.signature,
    }), ENV, update.pid);

    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith('upsert_participant_color', {
      p_pid: update.pid,
      p_cursor_color: update.color,
      p_color_version: update.version,
    });
  });

  it('rejects a signature captured for a different color', async () => {
    const update = await createSignedUpdate('#4a9a8a', 1);

    const response = await handleParticipantUpsert(makeRequest({
      cursor_color: '#123456',
      version: update.version,
      signature: update.signature,
    }), ENV, update.pid);

    expect(response.status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('rejects a signature captured for a different version', async () => {
    const update = await createSignedUpdate('#4a9a8a', 1);

    const response = await handleParticipantUpsert(makeRequest({
      cursor_color: update.color,
      version: 2,
      signature: update.signature,
    }), ENV, update.pid);

    expect(response.status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('rejects a captured older valid update after a newer color', async () => {
    const update = await createSignedUpdate('#4a9a8a', 1);
    rpc.mockResolvedValue({ data: false, error: null });

    const response = await handleParticipantUpsert(makeRequest({
      cursor_color: update.color,
      version: update.version,
      signature: update.signature,
    }), ENV, update.pid);

    expect(response.status).toBe(409);
    expect(rpc).toHaveBeenCalledWith('upsert_participant_color', {
      p_pid: update.pid,
      p_cursor_color: update.color,
      p_color_version: update.version,
    });
  });
});
