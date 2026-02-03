import { createSupabaseClient, type Env } from '../lib/supabase';
import type { CollectionEvent, EventMeta } from '../../../src/shared/types';

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

/**
 * GET /events/recent
 * Get recent events for live artwork rendering
 * Public endpoint (no auth required)
 *
 * Query parameters:
 * - type: Event type filter (default: 'cursor')
 * - limit: Maximum number of events (default: 1000, max: 5000). Pagination is used to return up to 5000.
 * - domain: Domain filter (optional) - filters events by URL domain
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

    const supabase = createSupabaseClient(env);
    const allRows: Record<string, unknown>[] = [];

    for (let offset = 0; offset < limit; offset += SUPABASE_PAGE_SIZE) {
      const from = offset;
      const to = offset + SUPABASE_PAGE_SIZE - 1;
      const { data, error } = await supabase
        .from('collection_events')
        .select('*')
        .eq('type', type)
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

    // Transform back to CollectionEvent format (cap at limit)
    const rows = allRows.slice(0, limit);
    let events: CollectionEvent[] = rows.map((row: Record<string, unknown>) => ({
      id: row.id as string,
      type: row.type as CollectionEvent['type'],
      ts: new Date(row.ts as string).getTime(),
      data: row.data as CollectionEvent['data'],
      meta: {
        pid: row.participant_id,
        sid: row.session_id,
        url: row.url,
        vw: row.viewport_width,
        vh: row.viewport_height,
        tz: row.timezone,
      } as EventMeta,
    }));
    
    // Filter by domain if provided
    if (domainFilter) {
      events = events.filter((event) => {
        const eventDomain = extractDomain(event.meta.url || '');
        return eventDomain === domainFilter;
      });
    }
    
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
