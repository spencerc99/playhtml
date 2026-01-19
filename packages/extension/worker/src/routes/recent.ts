import { createSupabaseClient, type Env } from '../lib/supabase';

/**
 * GET /events/recent
 * Get recent events for live artwork rendering
 * Public endpoint (no auth required)
 */
export async function handleRecent(
  request: Request,
  env: Env
): Promise<Response> {
  try {
    const url = new URL(request.url);
    const type = url.searchParams.get('type') || 'cursor';
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '1000', 10), 5000);
    
    const supabase = createSupabaseClient(env);
    const { data, error } = await supabase
      .from('collection_events')
      .select('*')
      .eq('type', type)
      .order('ts', { ascending: false })
      .limit(limit);
    
    if (error) {
      console.error('Supabase query error:', error);
      return new Response(
        JSON.stringify({ error: 'Failed to fetch events', details: error.message }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }
    
    // Transform back to CollectionEvent format
    const events = (data || []).map((row) => ({
      id: row.id,
      type: row.type,
      ts: new Date(row.ts).getTime(),
      data: row.data,
      meta: {
        pid: row.participant_id,
        sid: row.session_id,
        url: row.url,
        vw: row.viewport_width,
        vh: row.viewport_height,
        tz: row.timezone,
      },
    }));
    
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
