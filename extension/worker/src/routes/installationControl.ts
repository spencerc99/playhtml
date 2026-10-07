// ABOUTME: Reads and advances the reload generation for WWO installation screens.
// ABOUTME: Keeps public polling data minimal while protecting operator mutations.

import { getAdminAuthError } from '../lib/adminAuth';
import type { Env } from '../lib/supabase';

const RESPONSE_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Cache-Control': 'no-store',
};

type InstallationControlRow = {
  reload_generation: number;
  updated_at: string;
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: RESPONSE_HEADERS,
  });
}

function publicControl(row: InstallationControlRow) {
  return {
    generation: row.reload_generation,
    updatedAt: row.updated_at,
  };
}

export async function handleInstallationControl(env: Env): Promise<Response> {
  const row = await env.WWO_ADMIN_DB.prepare(
    `SELECT reload_generation, updated_at
      FROM installation_control
      WHERE control_id = 1`,
  ).first<InstallationControlRow>();

  if (!row) return jsonResponse(500, { error: 'Installation control is unavailable' });
  return jsonResponse(200, publicControl(row));
}

export async function handleAdminInstallationReload(
  request: Request,
  env: Env,
): Promise<Response> {
  const authError = getAdminAuthError(request, env.ADMIN_KEY);
  if (authError) return authError;

  const row = await env.WWO_ADMIN_DB.prepare(
    `UPDATE installation_control
      SET reload_generation = reload_generation + 1,
          updated_at = CURRENT_TIMESTAMP
      WHERE control_id = 1
      RETURNING reload_generation, updated_at`,
  ).first<InstallationControlRow>();

  if (!row) return jsonResponse(500, { error: 'Installation control is unavailable' });
  return jsonResponse(200, publicControl(row));
}
