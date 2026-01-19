import { createSupabaseClient, type Env } from '../lib/supabase';

/**
 * POST /events/export
 * Export edition data to JSON format
 * Requires API key authentication
 */
export async function handleExport(
  request: Request,
  env: Env
): Promise<Response> {
  // Check authentication
  const authHeader = request.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return new Response('Unauthorized', { status: 401 });
  }
  
  const token = authHeader.substring(7);
  if (token !== env.API_KEY) {
    return new Response('Unauthorized', { status: 401 });
  }
  
  try {
    const body = await request.json();
    const { type, startDate, endDate, name } = body;
    
    if (!type || !startDate || !endDate) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields: type, startDate, endDate' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }
    
    const supabase = createSupabaseClient(env);
    
    // Query events in date range
    const { data, error, count } = await supabase
      .from('collection_events')
      .select('*', { count: 'exact' })
      .eq('type', type)
      .gte('ts', startDate)
      .lt('ts', endDate)
      .order('ts', { ascending: true });
    
    if (error) {
      console.error('Supabase export error:', error);
      return new Response(
        JSON.stringify({ error: 'Failed to export events', details: error.message }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }
    
    // Get unique participants
    const participants = new Set(
      (data || []).map((e) => e.participant_id)
    );
    
    // Transform to CollectionEvent format
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
    
    const edition = {
      name: name || `Internet Movement ${new Date(startDate).toLocaleDateString()}`,
      type,
      startDate,
      endDate,
      participantCount: participants.size,
      eventCount: count || 0,
      exportedAt: new Date().toISOString(),
    };
    
    return new Response(
      JSON.stringify({
        edition,
        events,
      }),
      { 
        status: 200,
        headers: { 
          'Content-Type': 'application/json',
          'Content-Disposition': `attachment; filename="${edition.name.replace(/\s+/g, '-')}.json"`,
        }
      }
    );
  } catch (error) {
    console.error('Export error:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
