// ABOUTME: Serves recent browsing events filtered by domain for the historical overlay.
// ABOUTME: Public endpoint that queries Supabase using the domain index for fast lookups.
// ABOUTME: Navigation events have titles stripped at ingest (stored in page_metadata_history);
// ABOUTME: this handler re-joins them by page_ref before returning.

import { createSupabaseClient, type Env } from '../lib/supabase';
import type { CollectionEvent, EventMeta } from '../../../src/shared/types';
import { canonicalizeUrl, buildPageRef } from '../../../src/utils/pageMetadata';

/**
 * Extract domain from URL, matching frontend logic
 * Removes 'www.' prefix and returns hostname
 */
function extractDomain(url: string | null): string {
  if (!url) return '';
  try {
    const urlObj = new URL(url.startsWith('http') ? url : `https://${url}`);
    return urlObj.hostname.replace('www.', '');
  } catch {
    return '';
  }
}

/** Supabase/PostgREST returns at most 1000 rows per request; we paginate to satisfy larger limits. */
const SUPABASE_PAGE_SIZE = 1000;

type PageMeta = { title?: string; favicon_url?: string };

/**
 * Fetch the most-recently-observed title and favicon for each page_ref from page_metadata_history.
 * Batches the .in() call to stay within PostgREST URL length limits.
 */
async function fetchMetaByPageRef(
  supabase: ReturnType<typeof createSupabaseClient>,
  pageRefs: string[]
): Promise<Map<string, PageMeta>> {
  const metaByRef = new Map<string, PageMeta>();
  if (pageRefs.length === 0) return metaByRef;

  const CHUNK_SIZE = 200;
  for (let i = 0; i < pageRefs.length; i += CHUNK_SIZE) {
    const chunk = pageRefs.slice(i, i + CHUNK_SIZE);
    const { data: metaRows } = await supabase
      .from('page_metadata_history')
      .select('page_ref, title, favicon_url')
      .in('page_ref', chunk)
      .is('valid_to_ts', null); // current (most recent) entry per page_ref

    for (const row of metaRows ?? []) {
      if (row.page_ref && (row.title || row.favicon_url)) {
        metaByRef.set(row.page_ref, {
          ...(row.title ? { title: row.title } : {}),
          ...(row.favicon_url ? { favicon_url: row.favicon_url } : {}),
        });
      }
    }
  }

  return metaByRef;
}

/**
 * GET /events/recent
 * Get recent events for live artwork rendering
 * Public endpoint (no auth required)
 *
 * Query parameters:
 * - type: Event type filter (default: 'cursor')
 * - limit: Maximum number of events (default: 1000, max: 5000). Pagination is used to return up to 5000.
 * - domain: Domain filter (optional) - filters events by URL domain
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
  try {
    const url = new URL(request.url);
    const type = url.searchParams.get('type') || 'cursor';
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '1000', 10), 5000);
    const domainFilter = url.searchParams.get('domain') || null;
    const requireTitle = url.searchParams.get('require_title') === 'true';

    const supabase = createSupabaseClient(env);
    const allRows: Record<string, unknown>[] = [];

    for (let offset = 0; offset < limit; offset += SUPABASE_PAGE_SIZE) {
      const from = offset;
      const to = offset + SUPABASE_PAGE_SIZE - 1;

      let query = supabase
        .from('collection_events')
        .select('*')
        .eq('type', type);

      if (domainFilter) {
        query = query.eq('domain', domainFilter);
      }

      const fromDate = url.searchParams.get('from');
      const toDate = url.searchParams.get('to');
      if (fromDate) query = query.gte('ts', fromDate);
      if (toDate) query = query.lte('ts', toDate);

      const { data, error } = await query
        .order('ts', { ascending: false })
        .range(from, to);

      if (error) {
        console.error('Supabase query error:', error);
        return new Response(
          JSON.stringify({ error: 'Failed to fetch events', details: error.message }),
          { status: 500, headers: { 'Content-Type': 'application/json' } }
        );
      }

      const page = data ?? [];
      allRows.push(...page);
      if (page.length < SUPABASE_PAGE_SIZE) break;
    }

    // Cap at requested limit
    const rows = allRows.slice(0, limit);

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
    const participantColors = new Map<string, string>();

    if (participantIds.length > 0) {
      const { data: participants } = await supabase
        .from('participants')
        .select('pid, cursor_color')
        .in('pid', participantIds);

      if (participants) {
        for (const p of participants) {
          participantColors.set(p.pid, p.cursor_color);
        }
      }
    }

    // ── Build response events ─────────────────────────────────────────────────
    const allEvents: CollectionEvent[] = rows.map((row: Record<string, unknown>) => {
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

    // Apply require_title filter after the join — drops events where no metadata
    // row exists (e.g. older events ingested before page_metadata_history existed).
    const events = requireTitle
      ? allEvents.filter((e) => !!((e.data as Record<string, unknown>).title))
      : allEvents;
    
    return new Response(
      JSON.stringify(events),
      { 
        status: 200,
        headers: { 
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        }
      }
    );
  } catch (error) {
    console.error('Recent events error:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
