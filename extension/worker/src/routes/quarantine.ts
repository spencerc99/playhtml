// ABOUTME: Quarantine-tape endpoints — read/lay/rip caution-tape strips on a URL to mark AI slop / SEO spam.
// ABOUTME: Public, rate-limited, Supabase-backed. The verdict is the set of strips for a normalized URL.

import { createSupabaseClient, type Env } from '../lib/supabase';
import { createIpRateLimiter } from '../lib/ipRateLimit';

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
};

const WALLS = ['top', 'right', 'bottom', 'left'] as const;
const TYPES = ['slop', 'spam'] as const;
type Wall = (typeof WALLS)[number];
type TapeType = (typeof TYPES)[number];

// Setness: a page reads as "cordoned" once it has this many standing strips.
// Also the number of independent rips it takes to tear a set strip down.
const SET_THRESHOLD = 3;

const rateLimiter = createIpRateLimiter(30, 60_000);

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: CORS_HEADERS });
}

/**
 * Normalize a URL to a stable verdict key. Unlike the extension's page-URL
 * normalization, this KEEPS the query string — for an image `src` the query
 * often carries the image's identity (?w=800&sig=…). Only the hash is dropped.
 * Getting this right is migration-critical: collapsing distinct URLs onto one
 * key is irreversible.
 */
function normalizeArtifactUrl(raw: string): string | null {
  try {
    const u = new URL(raw);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    u.protocol = 'https:';
    u.hash = '';
    u.hostname = u.hostname.toLowerCase();
    let out = u.toString();
    // strip a trailing slash on the path (but keep it for a bare origin)
    if (out.endsWith('/') && u.pathname !== '/') out = out.slice(0, -1);
    return out;
  } catch {
    return null;
  }
}

interface EdgePoint {
  wall: Wall;
  t: number;
}

interface RipMark {
  by: string;
  at: number;
  pos: number;
}

interface StripRow {
  id: string;
  url: string;
  type: TapeType;
  a_wall: Wall;
  a_t: number;
  b_wall: Wall;
  b_t: number;
  seed: number;
  created_by: string;
  created_at: string;
  rips: RipMark[];
  rips_required: number | null;
}

interface StripDTO {
  id: string;
  type: TapeType;
  a: EdgePoint;
  b: EdgePoint;
  seed: number;
  createdBy: string;
  createdAt: string;
  rips: RipMark[];
  ripsRequired: number | null;
}

function toDTO(row: StripRow): StripDTO {
  return {
    id: row.id,
    type: row.type,
    a: { wall: row.a_wall, t: row.a_t },
    b: { wall: row.b_wall, t: row.b_t },
    seed: Number(row.seed),
    createdBy: row.created_by,
    createdAt: row.created_at,
    rips: Array.isArray(row.rips) ? row.rips : [],
    ripsRequired: row.rips_required,
  };
}

function validEdge(e: unknown): e is EdgePoint {
  return (
    !!e &&
    typeof e === 'object' &&
    WALLS.includes((e as EdgePoint).wall) &&
    typeof (e as EdgePoint).t === 'number' &&
    (e as EdgePoint).t >= 0 &&
    (e as EdgePoint).t <= 1
  );
}

function getIp(request: Request): string {
  return request.headers.get('CF-Connecting-IP') || 'unknown';
}

// GET /quarantine/verdict?url=<url>
export async function handleQuarantineVerdict(request: Request, env: Env): Promise<Response> {
  if (rateLimiter.isLimited(getIp(request), Date.now())) {
    return jsonResponse(429, { error: 'Too many requests. Try again in a minute.' });
  }

  const url = new URL(request.url).searchParams.get('url');
  const key = url ? normalizeArtifactUrl(url) : null;
  if (!key) return jsonResponse(400, { error: 'Invalid or missing url' });

  const supabase = createSupabaseClient(env);
  const { data, error } = await supabase
    .from('quarantine_strips')
    .select('*')
    .eq('url', key)
    .order('created_at', { ascending: true });

  if (error) {
    console.error('[Quarantine] verdict query failed:', error);
    return jsonResponse(503, { error: 'Store temporarily unavailable' });
  }

  return jsonResponse(200, { strips: (data as StripRow[]).map(toDTO) });
}

interface StripBody {
  url?: unknown;
  type?: unknown;
  a?: unknown;
  b?: unknown;
  seed?: unknown;
  createdBy?: unknown;
}

// POST /quarantine/strip — lay a new strip on a URL
export async function handleQuarantineStrip(request: Request, env: Env): Promise<Response> {
  if (rateLimiter.isLimited(getIp(request), Date.now())) {
    return jsonResponse(429, { error: 'Too many requests. Try again in a minute.' });
  }

  let body: StripBody;
  try {
    body = (await request.json()) as StripBody;
  } catch {
    return jsonResponse(400, { error: 'Invalid JSON body' });
  }

  const key = typeof body.url === 'string' ? normalizeArtifactUrl(body.url) : null;
  if (!key) return jsonResponse(400, { error: 'Invalid or missing url' });
  if (!TYPES.includes(body.type as TapeType)) {
    return jsonResponse(400, { error: 'Invalid type' });
  }
  if (!validEdge(body.a) || !validEdge(body.b)) {
    return jsonResponse(400, { error: 'Invalid edge points' });
  }
  const seed = typeof body.seed === 'number' ? Math.trunc(body.seed) : NaN;
  if (!Number.isFinite(seed)) return jsonResponse(400, { error: 'Invalid seed' });
  const createdBy = typeof body.createdBy === 'string' ? body.createdBy : '';
  if (!createdBy) return jsonResponse(400, { error: 'Missing createdBy' });

  const a = body.a as EdgePoint;
  const b = body.b as EdgePoint;

  const supabase = createSupabaseClient(env);
  const { data, error } = await supabase
    .from('quarantine_strips')
    .insert({
      url: key,
      type: body.type,
      a_wall: a.wall,
      a_t: a.t,
      b_wall: b.wall,
      b_t: b.t,
      seed,
      created_by: createdBy,
    })
    .select('*')
    .single();

  if (error) {
    console.error('[Quarantine] strip insert failed:', error);
    return jsonResponse(503, { error: 'Store temporarily unavailable' });
  }

  return jsonResponse(200, { strip: toDTO(data as StripRow) });
}

interface RipBody {
  url?: unknown;
  stripId?: unknown;
  by?: unknown;
  pos?: unknown;
}

// POST /quarantine/rip — tear at a strip
export async function handleQuarantineRip(request: Request, env: Env): Promise<Response> {
  if (rateLimiter.isLimited(getIp(request), Date.now())) {
    return jsonResponse(429, { error: 'Too many requests. Try again in a minute.' });
  }

  let body: RipBody;
  try {
    body = (await request.json()) as RipBody;
  } catch {
    return jsonResponse(400, { error: 'Invalid JSON body' });
  }

  const key = typeof body.url === 'string' ? normalizeArtifactUrl(body.url) : null;
  if (!key) return jsonResponse(400, { error: 'Invalid or missing url' });
  const stripId = typeof body.stripId === 'string' ? body.stripId : '';
  if (!stripId) return jsonResponse(400, { error: 'Missing stripId' });
  const by = typeof body.by === 'string' ? body.by : '';
  if (!by) return jsonResponse(400, { error: 'Missing by' });
  const pos =
    typeof body.pos === 'number' && body.pos >= 0 && body.pos <= 1 ? body.pos : 0.5;

  const supabase = createSupabaseClient(env);

  const { data: row, error: loadErr } = await supabase
    .from('quarantine_strips')
    .select('*')
    .eq('id', stripId)
    .maybeSingle();

  if (loadErr) {
    console.error('[Quarantine] rip load failed:', loadErr);
    return jsonResponse(503, { error: 'Store temporarily unavailable' });
  }
  if (!row) return jsonResponse(404, { error: 'Strip not found' });

  const strip = row as StripRow;
  const rips: RipMark[] = Array.isArray(strip.rips) ? strip.rips : [];

  // idempotent per player — you can't stack your own rips
  if (rips.some((r) => r.by === by)) {
    return jsonResponse(200, { strip: toDTO(strip) });
  }

  // snapshot rips-required on the FIRST rip so teardown can't oscillate as the
  // page's standing-strip count changes underneath it.
  let ripsRequired = strip.rips_required;
  if (ripsRequired === null) {
    const { count } = await supabase
      .from('quarantine_strips')
      .select('id', { count: 'exact', head: true })
      .eq('url', key);
    ripsRequired = (count ?? 0) >= SET_THRESHOLD ? SET_THRESHOLD : 1;
  }

  const nextRips = [...rips, { by, at: Date.now(), pos }];

  const { data: updated, error: updErr } = await supabase
    .from('quarantine_strips')
    .update({ rips: nextRips, rips_required: ripsRequired })
    .eq('id', stripId)
    .select('*')
    .single();

  if (updErr) {
    console.error('[Quarantine] rip update failed:', updErr);
    return jsonResponse(503, { error: 'Store temporarily unavailable' });
  }

  return jsonResponse(200, { strip: toDTO(updated as StripRow) });
}

// Exported for tests that want to clear in-memory rate-limit state between cases.
export function __resetRateLimitForTests(): void {
  rateLimiter.reset();
}
