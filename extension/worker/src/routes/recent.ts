// ABOUTME: Serves recent browsing events filtered by domain for the historical overlay.
// ABOUTME: Public endpoint that pages through Supabase collection_events newest first.
// ABOUTME: Navigation events have titles stripped at ingest (stored in page_metadata_history);
// ABOUTME: this handler re-joins them by page_ref before returning.

import { createSupabaseClient, type Env } from '../lib/supabase';
import { loadParticipantColors } from '../lib/participantColors';
import { getEarlierEventFilter } from '../lib/eventCursorFilter';
import { parseOptionalIsoDate, parseOptionalPositiveInt } from '../lib/requestInput';
import {
  buildPageRef,
  canonicalizeUrl,
  type CollectionEvent,
  type EventMeta,
} from '@playhtml/extension-types';

/** Supabase/PostgREST returns at most 1000 rows per request; we paginate to satisfy larger limits. */
const SUPABASE_PAGE_SIZE = 1000;

interface RecentEventCursor {
  ts: string;
  id: string;
}

interface RecentEventPage {
  data: Record<string, unknown>[] | null;
  error: { message: string } | null;
}

type RecentEventRows =
  | { rows: Record<string, unknown>[]; error: null }
  | { rows: null; error: { message: string } };

export async function loadRecentEventRows(
  limit: number,
  loadPage: (
    cursor: RecentEventCursor | null,
    pageSize: number,
  ) => Promise<RecentEventPage>,
): Promise<RecentEventRows> {
  const rows: Record<string, unknown>[] = [];
  let cursor: RecentEventCursor | null = null;

  while (rows.length < limit) {
    const pageSize = Math.min(SUPABASE_PAGE_SIZE, limit - rows.length);
    const result = await loadPage(cursor, pageSize);
    if (result.error) return { rows: null, error: result.error };

    const page = result.data ?? [];
    rows.push(...page);
    if (page.length < pageSize) break;

    const lastRow = page.at(-1);
    if (typeof lastRow?.ts !== 'string' || typeof lastRow.id !== 'string') {
      throw new Error('Recent event row is missing pagination fields');
    }
    cursor = { ts: lastRow.ts, id: lastRow.id };
  }

  return { rows, error: null };
}

export function getRecentEventTypeFilter(url: URL): string | null {
  const requestedType = url.searchParams.get('type');
  return requestedType === 'all' ? null : requestedType || 'cursor';
}

/**
 * Participant ids of the newest events (any type) at or after `since`,
 * newest first, at most `limit` rows. Selects only the id column so counting
 * who is browsing never loads event payloads, titles, or colors. Ids repeat
 * once per event.
 */
export async function loadRecentParticipantIds(
  env: Env,
  since: number,
  limit: number,
): Promise<string[]> {
  if (limit > SUPABASE_PAGE_SIZE) {
    throw new Error(`Participant id limit ${limit} exceeds one Supabase page`);
  }

  const supabase = createSupabaseClient(env);
  const { data, error } = await supabase
    .from('collection_events')
    .select('participant_id')
    .gte('ts', new Date(since).toISOString())
    .order('ts', { ascending: false })
    .limit(limit);
  if (error) {
    throw new Error(`Recent participant query failed: ${error.message}`);
  }
  if (!Array.isArray(data)) {
    throw new Error('Recent participant query returned no rows array');
  }

  return data.map((row) => {
    const participantId = (row as { participant_id?: unknown }).participant_id;
    if (typeof participantId !== 'string' || !participantId) {
      throw new Error('Recent participant row is missing participant_id');
    }
    return participantId;
  });
}

type PageMeta = { title?: string; favicon_url?: string };

/** page_refs per .in() call, to stay within PostgREST URL length limits. */
const PAGE_META_CHUNK_SIZE = 200;
/** page_metadata_history requests in flight at once. */
const PAGE_META_CONCURRENCY = 4;

/**
 * Fetch the most-recently-observed title and favicon for each page_ref from page_metadata_history.
 * Splits the refs into chunks and runs up to PAGE_META_CONCURRENCY chunk queries at once.
 */
async function fetchMetaByPageRef(
  supabase: ReturnType<typeof createSupabaseClient>,
  pageRefs: string[]
): Promise<Map<string, PageMeta>> {
  const metaByRef = new Map<string, PageMeta>();
  if (pageRefs.length === 0) return metaByRef;

  const chunks: string[][] = [];
  for (let i = 0; i < pageRefs.length; i += PAGE_META_CHUNK_SIZE) {
    chunks.push(pageRefs.slice(i, i + PAGE_META_CHUNK_SIZE));
  }

  const loadChunk = async (chunk: string[]) => {
    const { data: metaRows, error } = await supabase
      .from('page_metadata_history')
      .select('page_ref, title, favicon_url')
      .in('page_ref', chunk)
      .is('valid_to_ts', null); // current (most recent) entry per page_ref
    if (error) {
      throw new Error(`Page metadata lookup failed: ${error.message}`);
    }

    for (const row of metaRows ?? []) {
      if (row.page_ref && (row.title || row.favicon_url)) {
        metaByRef.set(row.page_ref, {
          ...(row.title ? { title: row.title } : {}),
          ...(row.favicon_url ? { favicon_url: row.favicon_url } : {}),
        });
      }
    }
  };

  for (let i = 0; i < chunks.length; i += PAGE_META_CONCURRENCY) {
    await Promise.all(chunks.slice(i, i + PAGE_META_CONCURRENCY).map(loadChunk));
  }

  return metaByRef;
}

/**
 * Turns collection_events rows into extension events: re-attaches navigation
 * titles and favicons from page_metadata_history and each participant's cursor color.
 */
export async function toCollectionEvents(
  supabase: ReturnType<typeof createSupabaseClient>,
  rows: Record<string, unknown>[],
): Promise<CollectionEvent[]> {
  // ── Join page titles from page_metadata_history ───────────────────────────
  // Titles are stripped from navigation event rows at ingest time and stored
  // in page_metadata_history keyed by page_ref. Re-attach them here.
  //
  // Two lookup strategies, applied per row:
  //   1. data.page_ref  — present on events ingested after getPageSnapshot() was added
  //   2. normalize(meta.url) → buildPageRef(...)  — fallback for older events
  //
  // We collect all candidate refs in one batch to minimise round-trips.

  // Map from page_ref → the row id(s) that need it, so we can attach titles back.
  // rowRefMap[rowId] = page_ref to use for that row.
  const rowRefMap = new Map<string, string>();

  for (const row of rows) {
    if (row.type !== 'navigation') continue;

    const d = row.data as Record<string, unknown> | null;
    const storedRef = d?.page_ref as string | undefined;

    if (storedRef) {
      rowRefMap.set(row.id as string, storedRef);
    } else if (row.url) {
      // Older event: no page_ref in data — derive it from the stored URL
      const fallbackRef = buildPageRef(canonicalizeUrl(row.url as string));
      rowRefMap.set(row.id as string, fallbackRef);
    }
  }

  const allPageRefs = [...new Set(rowRefMap.values())];
  const metaByRef = await fetchMetaByPageRef(supabase, allPageRefs);

  // ── Look up cursor colors ─────────────────────────────────────────────────
  const participantIds = [...new Set(rows.map((row) => row.participant_id as string))];
  const participantColors = await loadParticipantColors(participantIds, ids =>
    supabase
      .from('participants')
      .select('pid, cursor_color')
      .in('pid', ids),
  );

  // ── Build response events ─────────────────────────────────────────────────
  return rows.map((row: Record<string, unknown>) => {
    const data = (row.data ?? {}) as Record<string, unknown>;
    const pageRef = rowRefMap.get(row.id as string);
    const pageMeta = pageRef ? metaByRef.get(pageRef) : undefined;
    const title = pageMeta?.title;
    const faviconUrl = pageMeta?.favicon_url;

    return {
      id: row.id as string,
      type: row.type as CollectionEvent['type'],
      ts: new Date(row.ts as string).getTime(),
      // Merge title and favicon back into data from page_metadata_history
      data: title || faviconUrl
        ? { ...data, ...(title ? { title } : {}), ...(faviconUrl ? { favicon_url: faviconUrl } : {}) }
        : data,
      meta: {
        pid: row.participant_id,
        sid: row.session_id,
        url: row.url,
        vw: row.viewport_width,
        vh: row.viewport_height,
        tz: row.timezone,
        cursor_color: participantColors.get(row.participant_id as string) ?? null,
      } as EventMeta,
    };
  });
}

export interface RecentEventQuery {
  /** Event type to return; null returns every type. */
  type: string | null;
  /** Maximum number of rows to read before the require_title filter. */
  limit: number;
  domain: string | null;
  pid: string | null;
  /** Inclusive ISO lower bound on ts. */
  from: string | null;
  /** Inclusive ISO upper bound on ts. */
  to: string | null;
  /** Drops events with no title in page_metadata_history. */
  requireTitle: boolean;
}

export type RecentEvents =
  | { events: CollectionEvent[]; error: null }
  | { events: null; error: { message: string } };

/**
 * Newest-first events matching `query`, with navigation titles, favicons, and
 * cursor colors re-attached. A failed collection_events page returns its
 * error; failed metadata or color lookups throw.
 */
export async function loadRecentEvents(
  env: Env,
  query: RecentEventQuery,
): Promise<RecentEvents> {
  const supabase = createSupabaseClient(env);
  const { rows, error } = await loadRecentEventRows(query.limit, async (cursor, pageSize) => {
    let request = supabase
      .from('collection_events')
      .select('*');

    if (query.type !== null) request = request.eq('type', query.type);
    if (query.domain) request = request.eq('domain', query.domain);
    if (query.pid) request = request.eq('participant_id', query.pid);
    if (query.from) request = request.gte('ts', query.from);
    if (query.to) request = request.lte('ts', query.to);
    if (cursor) request = request.or(getEarlierEventFilter(cursor.ts, cursor.id));

    return request
      .order('ts', { ascending: false })
      .order('id', { ascending: false })
      .limit(pageSize);
  });

  if (error) return { events: null, error };

  const allEvents = await toCollectionEvents(supabase, rows);

  // Applied after the page_metadata_history join: drops events with no
  // metadata row (e.g. older events ingested before page_metadata_history existed).
  const events = query.requireTitle
    ? allEvents.filter((e) => !!((e.data as Record<string, unknown>).title))
    : allEvents;
  return { events, error: null };
}

/**
 * GET /events/recent
 * Get recent events for live artwork rendering
 * Public endpoint (no auth required)
 *
 * Query parameters:
 * - type: Event type filter (default: 'cursor'; 'all' disables the filter)
 * - limit: Maximum number of events, a positive integer (default: 1000, max: 20000). Pagination is used internally.
 * - domain: Domain filter (optional) - filters events by URL domain
 * - pid: Participant ID filter (optional)
 * - from: ISO date string, inclusive lower bound on ts (optional)
 * - to: ISO date string, inclusive upper bound on ts (optional)
 * - require_title: 'true' to omit events for which no title exists in page_metadata_history (optional)
 *   Note: navigation event titles are stored separately (ingest strips them from the event row).
 *   This filter is applied after the page_metadata_history join, not at the SQL level.
 */
export async function handleRecent(
  request: Request,
  env: Env
): Promise<Response> {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  };
  try {
    const url = new URL(request.url);
    const limit = parseOptionalPositiveInt(url.searchParams, 'limit');
    if (!limit.ok) {
      return new Response(
        JSON.stringify({ error: 'Invalid limit (expected a positive integer)' }),
        { status: 400, headers }
      );
    }
    const from = parseOptionalIsoDate(url.searchParams, 'from');
    const to = parseOptionalIsoDate(url.searchParams, 'to');
    if (!from.ok || !to.ok) {
      return new Response(
        JSON.stringify({ error: 'Invalid from/to (expected an ISO date)' }),
        { status: 400, headers }
      );
    }
    const { events, error } = await loadRecentEvents(env, {
      type: getRecentEventTypeFilter(url),
      limit: Math.min(limit.value ?? 1000, 20000),
      domain: url.searchParams.get('domain') || null,
      pid: url.searchParams.get('pid') || null,
      from: from.value,
      to: to.value,
      requireTitle: url.searchParams.get('require_title') === 'true',
    });

    if (error) {
      console.error('Supabase query error:', error);
      return new Response(
        JSON.stringify({ error: 'Failed to fetch events', details: error.message }),
        { status: 500, headers }
      );
    }

    return new Response(JSON.stringify(events), { status: 200, headers });
  } catch (error) {
    console.error('Recent events error:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers }
    );
  }
}
