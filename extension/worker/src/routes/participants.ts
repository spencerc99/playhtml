// ABOUTME: Handles participant profile upserts
// ABOUTME: Public endpoint for syncing participant cursor color to Supabase

import { createSupabaseClient, type Env } from '../lib/supabase';

const HEX_COLOR_REGEX = /^#[0-9a-fA-F]{6}$/;
const HSL_COLOR_REGEX = /^hsl\(\s*\d{1,3}\s*,\s*\d{1,3}%?\s*,\s*\d{1,3}%?\s*\)$/;

function isValidColor(color: string): boolean {
  return HEX_COLOR_REGEX.test(color) || HSL_COLOR_REGEX.test(color);
}

function isValidPid(pid: string): boolean {
  return pid.startsWith('pk_') && pid.length > 10;
}

/**
 * PUT /participants/:pid
 * Upsert participant profile (cursor color).
 * Public endpoint — validated but no auth required.
 */
export async function handleParticipantUpsert(
  request: Request,
  env: Env,
  pid: string,
): Promise<Response> {
  try {
    if (!isValidPid(pid)) {
      return new Response(
        JSON.stringify({ error: 'Invalid participant ID format' }),
        { status: 400, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } }
      );
    }

    const body = await request.json() as Record<string, unknown>;
    const cursorColor = body.cursor_color;

    if (typeof cursorColor !== 'string' || !isValidColor(cursorColor)) {
      return new Response(
        JSON.stringify({ error: 'Invalid or missing cursor_color (expected hex like #4a9a8a or hsl)' }),
        { status: 400, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } }
      );
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
      return new Response(
        JSON.stringify({ error: 'Failed to save participant', details: error.message }),
        { status: 500, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } }
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
