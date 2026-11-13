// ABOUTME: Handles participant profile upserts (cursor color) in Supabase.
// ABOUTME: Signed with the pid's identity key; unsigned requests pass only while REQUIRE_PARTICIPANT_SIGNATURES is off.

import { createSupabaseClient, type Env } from '../lib/supabase';
import {
  carriesSignature,
  isParticipantKey,
  isSignatureHex,
  requiresParticipantSignatures,
  verifyParticipantSignature,
} from '../lib/participantKey';
import { readJsonObject } from '../lib/requestInput';
import {
  PARTICIPANT_COLOR_SIGNATURE_MAX_AGE_MS,
  participantColorSigningMessage,
  type ParticipantColorRequest,
} from '../../../src/utils/participantColorRequest';

const HEX_COLOR_REGEX = /^#[0-9a-fA-F]{6}$/;
const HSL_COLOR_REGEX = /^hsl\(\s*\d{1,3}\s*,\s*\d{1,3}%?\s*,\s*\d{1,3}%?\s*\)$/;

const JSON_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
};

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

function isValidColor(color: string): boolean {
  return HEX_COLOR_REGEX.test(color) || HSL_COLOR_REGEX.test(color);
}

/**
 * True when the pid's key signed this color within the freshness window.
 * There is no stored version or nonce, so a captured request can be replayed
 * until its signedAt leaves the window; a replay can only set the color the
 * participant themselves signed.
 */
export async function verifyParticipantColorSignature(
  request: ParticipantColorRequest,
  now: number,
): Promise<boolean> {
  if (Math.abs(now - request.signedAt) > PARTICIPANT_COLOR_SIGNATURE_MAX_AGE_MS) {
    return false;
  }
  return verifyParticipantSignature(
    request.pid,
    request.signature,
    participantColorSigningMessage(request),
  );
}

/**
 * PUT /participants/:pid
 * Upsert participant profile (cursor color). Body: { cursor_color, signedAt, signature }.
 * A signed request is always verified. An unsigned one is rejected when
 * REQUIRE_PARTICIPANT_SIGNATURES is "true" and accepted otherwise.
 */
export async function handleParticipantUpsert(
  request: Request,
  env: Env,
  pid: string,
): Promise<Response> {
  try {
    if (!isParticipantKey(pid)) {
      return jsonResponse({ error: 'Invalid participant ID format' }, 400);
    }

    const body = await readJsonObject(request);
    if (!body) return jsonResponse({ error: 'Invalid JSON body' }, 400);

    const cursorColor = body.cursor_color;
    if (typeof cursorColor !== 'string' || !isValidColor(cursorColor)) {
      return jsonResponse(
        { error: 'Invalid or missing cursor_color (expected hex like #4a9a8a or hsl)' },
        400,
      );
    }

    if (carriesSignature(body)) {
      const { signedAt, signature } = body;
      if (typeof signedAt !== 'number' || !Number.isFinite(signedAt) || !isSignatureHex(signature)) {
        return jsonResponse({ error: 'Malformed signature' }, 401);
      }
      let verified = false;
      try {
        verified = await verifyParticipantColorSignature(
          { pid, color: cursorColor, signedAt, signature },
          Date.now(),
        );
      } catch (error) {
        console.error('Participant color signature check failed:', error);
      }
      if (!verified) return jsonResponse({ error: 'Invalid signature' }, 401);
    } else if (requiresParticipantSignatures(env)) {
      return jsonResponse({ error: 'Missing signature' }, 401);
    } else {
      // Extension builds before request signing send no signature.
      console.log('[legacy-unsigned] PUT /participants/:pid');
    }

    const supabase = createSupabaseClient(env);
    const { error } = await supabase
      .from('participants')
      .upsert(
        {
          pid,
          cursor_color: cursorColor,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'pid' }
      );

    if (error) {
      console.error('Participant upsert error:', error);
      return jsonResponse({ error: 'Failed to save participant', details: error.message }, 500);
    }

    return jsonResponse({ ok: true }, 200);
  } catch (error) {
    console.error('Participant upsert error:', error);
    return jsonResponse({ error: 'Internal server error' }, 500);
  }
}
