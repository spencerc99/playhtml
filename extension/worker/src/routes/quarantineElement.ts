// ABOUTME: Quarantine-tape endpoints for INDIVIDUAL IMAGES — read/lay/rip tape on an image src.
// ABOUTME: Mirrors the page-strip routes but keyed by the image's src (query preserved); no wall geometry.

import { createSupabaseClient, type Env } from '../lib/supabase';
import { createIpRateLimiter } from '../lib/ipRateLimit';
import { normalizeArtifactUrl } from '../lib/artifactUrl';

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
};

const TYPES = ['slop', 'spam'] as const;
type TapeType = (typeof TYPES)[number];

const SET_THRESHOLD = 3;

const rateLimiter = createIpRateLimiter(30, 60_000);

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: CORS_HEADERS });
}

interface RipMark {
  by: string;
  at: number;
  pos: number;
}

interface MarkRow {
  id: string;
  src: string;
  type: TapeType;
  seed: number;
  created_by: string;
  created_at: string;
  rips: RipMark[];
  rips_required: number | null;
}

interface MarkDTO {
  id: string;
  src: string;
  type: TapeType;
  seed: number;
  createdBy: string;
  createdAt: string;
  rips: RipMark[];
  ripsRequired: number | null;
}

function toDTO(row: MarkRow): MarkDTO {
  return {
    id: row.id,
    src: row.src,
    type: row.type,
    seed: Number(row.seed),
    createdBy: row.created_by,
    createdAt: row.created_at,
    rips: Array.isArray(row.rips) ? row.rips : [],
    ripsRequired: row.rips_required,
  };
}

function getIp(request: Request): string {
  return request.headers.get('CF-Connecting-IP') || 'unknown';
}

// GET /quarantine/element-verdict?src=<a>&src=<b>&...
// Bulk by design: an image page has one src, but the on-page renderer asks about
// every tapeable image at once. Returns marks grouped by src.
export async function handleQuarantineElementVerdict(request: Request, env: Env): Promise<Response> {
  if (rateLimiter.isLimited(getIp(request), Date.now())) {
    return jsonResponse(429, { error: 'Too many requests. Try again in a minute.' });
  }

  const raw = new URL(request.url).searchParams.getAll('src');
  const keys = Array.from(
    new Set(raw.map((s) => normalizeArtifactUrl(s)).filter((s): s is string => !!s)),
  );
  if (keys.length === 0) return jsonResponse(400, { error: 'Missing src' });
  // Cap to keep the query bounded — a page with hundreds of images shouldn't
  // fan out unboundedly. Extra srcs are silently dropped (documented in notes).
  const capped = keys.slice(0, 100);

  const supabase = createSupabaseClient(env);
  const { data, error } = await supabase
    .from('quarantine_element_marks')
    .select('*')
    .in('src', capped)
    .order('created_at', { ascending: true });

  if (error) {
    console.error('[Quarantine] element verdict query failed:', error);
    return jsonResponse(503, { error: 'Store temporarily unavailable' });
  }

  const bySrc: Record<string, MarkDTO[]> = {};
  for (const row of data as MarkRow[]) {
    (bySrc[row.src] ??= []).push(toDTO(row));
  }
  return jsonResponse(200, { marks: bySrc });
}

interface MarkBody {
  src?: unknown;
  type?: unknown;
  seed?: unknown;
  createdBy?: unknown;
}

// POST /quarantine/element-mark — tape an image
export async function handleQuarantineElementMark(request: Request, env: Env): Promise<Response> {
  if (rateLimiter.isLimited(getIp(request), Date.now())) {
    return jsonResponse(429, { error: 'Too many requests. Try again in a minute.' });
  }

  let body: MarkBody;
  try {
    body = (await request.json()) as MarkBody;
  } catch {
    return jsonResponse(400, { error: 'Invalid JSON body' });
  }

  const key = typeof body.src === 'string' ? normalizeArtifactUrl(body.src) : null;
  if (!key) return jsonResponse(400, { error: 'Invalid or missing src' });
  if (!TYPES.includes(body.type as TapeType)) {
    return jsonResponse(400, { error: 'Invalid type' });
  }
  const seed = typeof body.seed === 'number' ? Math.trunc(body.seed) : NaN;
  if (!Number.isFinite(seed)) return jsonResponse(400, { error: 'Invalid seed' });
  const createdBy = typeof body.createdBy === 'string' ? body.createdBy : '';
  if (!createdBy) return jsonResponse(400, { error: 'Missing createdBy' });

  const supabase = createSupabaseClient(env);
  const { data, error } = await supabase
    .from('quarantine_element_marks')
    .insert({ src: key, type: body.type, seed, created_by: createdBy })
    .select('*')
    .single();

  if (error) {
    console.error('[Quarantine] element mark insert failed:', error);
    return jsonResponse(503, { error: 'Store temporarily unavailable' });
  }

  return jsonResponse(200, { mark: toDTO(data as MarkRow) });
}

interface ElementRipBody {
  src?: unknown;
  markId?: unknown;
  by?: unknown;
  pos?: unknown;
}

// POST /quarantine/element-rip — tear at an image's tape
export async function handleQuarantineElementRip(request: Request, env: Env): Promise<Response> {
  if (rateLimiter.isLimited(getIp(request), Date.now())) {
    return jsonResponse(429, { error: 'Too many requests. Try again in a minute.' });
  }

  let body: ElementRipBody;
  try {
    body = (await request.json()) as ElementRipBody;
  } catch {
    return jsonResponse(400, { error: 'Invalid JSON body' });
  }

  const key = typeof body.src === 'string' ? normalizeArtifactUrl(body.src) : null;
  if (!key) return jsonResponse(400, { error: 'Invalid or missing src' });
  const markId = typeof body.markId === 'string' ? body.markId : '';
  if (!markId) return jsonResponse(400, { error: 'Missing markId' });
  const by = typeof body.by === 'string' ? body.by : '';
  if (!by) return jsonResponse(400, { error: 'Missing by' });
  const pos = typeof body.pos === 'number' && body.pos >= 0 && body.pos <= 1 ? body.pos : 0.5;

  const supabase = createSupabaseClient(env);

  const { data: row, error: loadErr } = await supabase
    .from('quarantine_element_marks')
    .select('*')
    .eq('id', markId)
    .maybeSingle();

  if (loadErr) {
    console.error('[Quarantine] element rip load failed:', loadErr);
    return jsonResponse(503, { error: 'Store temporarily unavailable' });
  }
  if (!row) return jsonResponse(404, { error: 'Mark not found' });

  const mark = row as MarkRow;
  const rips: RipMark[] = Array.isArray(mark.rips) ? mark.rips : [];

  if (rips.some((r) => r.by === by)) {
    return jsonResponse(200, { mark: toDTO(mark) });
  }

  let ripsRequired = mark.rips_required;
  if (ripsRequired === null) {
    const { count } = await supabase
      .from('quarantine_element_marks')
      .select('id', { count: 'exact', head: true })
      .eq('src', key);
    ripsRequired = (count ?? 0) >= SET_THRESHOLD ? SET_THRESHOLD : 1;
  }

  const nextRips = [...rips, { by, at: Date.now(), pos }];

  const { data: updated, error: updErr } = await supabase
    .from('quarantine_element_marks')
    .update({ rips: nextRips, rips_required: ripsRequired })
    .eq('id', markId)
    .select('*')
    .single();

  if (updErr) {
    console.error('[Quarantine] element rip update failed:', updErr);
    return jsonResponse(503, { error: 'Store temporarily unavailable' });
  }

  return jsonResponse(200, { mark: toDTO(updated as MarkRow) });
}

export function __resetRateLimitForTests(): void {
  rateLimiter.reset();
}
