// ABOUTME: Handles participant profile upserts
// ABOUTME: Public endpoint for syncing participant cursor color to Supabase

import { createSupabaseClient, type Env } from '../lib/supabase';
import {
  isValidParticipantPid,
  verifyParticipantColorUpdate,
} from '../lib/participantProof';

const HEX_COLOR_REGEX = /^#[0-9a-fA-F]{6}$/;
const HSL_COLOR_REGEX = /^hsl\(\s*\d{1,3}\s*,\s*\d{1,3}%?\s*,\s*\d{1,3}%?\s*\)$/;

function isValidColor(color: string): boolean {
  return HEX_COLOR_REGEX.test(color) || HSL_COLOR_REGEX.test(color);
}

/**
 * PUT /participants/:pid
 * Upsert a signed participant cursor-color update.
 */
export async function handleParticipantUpsert(
  request: Request,
  env: Env,
  pid: string,
): Promise<Response> {
  try {
    if (!isValidParticipantPid(pid)) {
      return new Response(
        JSON.stringify({ error: 'Invalid participant ID format' }),
        { status: 400, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } }
      );
    }

    const body = await request.json() as Record<string, unknown>;
    const cursorColor = body.cursor_color;
    const version = body.version;
    const signature = body.signature;

    if (typeof cursorColor !== 'string' || !isValidColor(cursorColor)) {
      return new Response(
        JSON.stringify({ error: 'Invalid or missing cursor_color (expected hex like #4a9a8a or hsl)' }),
        { status: 400, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } }
      );
    }

    if (
      typeof version !== 'number' ||
      !Number.isSafeInteger(version) ||
      version <= 0 ||
      typeof signature !== 'string'
    ) {
      return new Response(
        JSON.stringify({ error: 'Invalid participant color proof' }),
        { status: 401, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } }
      );
    }

    if (!await verifyParticipantColorUpdate(pid, cursorColor, version, signature)) {
      return new Response(
        JSON.stringify({ error: 'Invalid participant color proof' }),
        { status: 401, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } }
      );
    }

    const supabase = createSupabaseClient(env);

    const { data: updated, error } = await supabase.rpc('upsert_participant_color', {
      p_pid: pid,
      p_cursor_color: cursorColor,
      p_color_version: version,
    });

    if (error) {
      console.error('Participant upsert error:', error);
      return new Response(
        JSON.stringify({ error: 'Failed to save participant', details: error.message }),
        { status: 500, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } }
      );
    }

    if (!updated) {
      return new Response(
        JSON.stringify({ error: 'Stale participant color update' }),
        { status: 409, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } }
      );
    }

    return new Response(
      JSON.stringify({ ok: true }),
      { status: 200, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } }
    );
  } catch (error) {
    console.error('Participant upsert error:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } }
    );
  }
}
