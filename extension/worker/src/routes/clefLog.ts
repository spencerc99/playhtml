// ABOUTME: Serves the curation desk's log of every answer Clef has given.
// ABOUTME: Pairs each answer with the human decision that now covers the page.

import { getAdminAuthError } from '../lib/adminAuth';
import type { Env } from '../lib/supabase';
import {
  resolveInternetPlacePolicy,
  type InternetPlacePlacement,
  type InternetPlacePolicy,
  type InternetPlaceScope,
} from '../../../shared/internetPlaceCatalog';

const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 1000;
const MAX_TEXT_PREVIEW = 400;

type LogRow = {
  id: number;
  page_key: string;
  kind: 'page' | 'name';
  prompt_version: string;
  input_json: string;
  suggestion_json: string;
  created_at: string;
};

type PolicyRow = {
  scope: InternetPlaceScope;
  place_key: string;
  placement: InternetPlacePlacement | null;
  note: string;
  updated_at: string;
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

/** Hidden, scenery, or any kind of stop: the distinction strangers notice. */
function bucket(placement: string | undefined): 'hidden' | 'scenery' | 'stop' | null {
  if (!placement) return null;
  if (placement === 'hidden' || placement === 'scenery') return placement;
  return 'stop';
}

/** Keeps what Clef saw readable without returning whole page bodies. */
function summarizeInput(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) return {};
  if (typeof value.hostname === 'string') return { hostname: value.hostname };
  const candidate = isRecord(value.candidate) ? value.candidate : {};
  const page = isRecord(candidate.page) ? candidate.page : undefined;
  return {
    ...(typeof candidate.title === 'string' ? { title: candidate.title } : {}),
    ...(isRecord(candidate.inspection) ? { inspection: candidate.inspection } : {}),
    ...(page
      ? {
          page: {
            ...(typeof page.description === 'string' ? { description: page.description } : {}),
            ...(typeof page.siteName === 'string' ? { siteName: page.siteName } : {}),
            headings: Array.isArray(page.headings) ? page.headings : [],
            text: typeof page.text === 'string' ? page.text.slice(0, MAX_TEXT_PREVIEW) : '',
          },
        }
      : {}),
    curatedExamples: Array.isArray(value.curatedExamples) ? value.curatedExamples : [],
  };
}

export async function handleClefLog(request: Request, env: Env): Promise<Response> {
  const authError = getAdminAuthError(request, env.ADMIN_KEY);
  if (authError) return authError;
  const params = new URL(request.url).searchParams;
  const requestedLimit = Number(params.get('limit') ?? DEFAULT_LIMIT);
  const limit = Number.isFinite(requestedLimit)
    ? Math.min(MAX_LIMIT, Math.max(1, Math.floor(requestedLimit)))
    : DEFAULT_LIMIT;
  const page = params.get('page');

  const [logRows, policyRows] = await Promise.all([
    env.WWO_ADMIN_DB.prepare(
      `SELECT id, page_key, kind, prompt_version, input_json, suggestion_json, created_at
       FROM place_clef_log
       ${page ? 'WHERE page_key = ?' : ''}
       ORDER BY created_at DESC, id DESC
       LIMIT ?`,
    ).bind(...(page ? [page, limit] : [limit])).all<LogRow>(),
    env.WWO_ADMIN_DB.prepare(
      'SELECT scope, place_key, placement, note, updated_at FROM place_policies',
    ).all<PolicyRow>(),
  ]);
  const policies: InternetPlacePolicy[] = (policyRows.results ?? [])
    .filter((row) => row.placement)
    .map((row) => ({
      scope: row.scope,
      placeKey: row.place_key,
      ...(row.placement ? { placement: row.placement } : {}),
      note: row.note,
      updatedAt: row.updated_at,
    }));

  let decided = 0;
  let agreed = 0;
  const entries = (logRows.results ?? []).map((row) => {
    const suggestion = parseJson(row.suggestion_json);
    const clefPlacement = isRecord(suggestion) && typeof suggestion.placement === 'string'
      ? suggestion.placement
      : undefined;
    const url = row.kind === 'name' ? `https://${row.page_key}/` : row.page_key;
    let human: InternetPlacePolicy | null = null;
    try {
      human = resolveInternetPlacePolicy(policies, url) ?? null;
    } catch {
      human = null;
    }
    const agreement = human?.placement && clefPlacement
      ? bucket(human.placement) === bucket(clefPlacement)
      : null;
    if (agreement !== null) {
      decided += 1;
      if (agreement) agreed += 1;
    }
    return {
      id: row.id,
      kind: row.kind,
      pageKey: row.page_key,
      promptVersion: row.prompt_version,
      createdAt: row.created_at,
      input: summarizeInput(parseJson(row.input_json)),
      suggestion,
      human: human
        ? { scope: human.scope, placeKey: human.placeKey, placement: human.placement }
        : null,
      agreed: agreement,
    };
  });

  return jsonResponse(200, { entries, summary: { decided, agreed } });
}
