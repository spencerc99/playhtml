import { createSupabaseClient, type Env } from '../lib/supabase';

/**
 * POST /events
 * Batch insert events from extension
 */
export async function handleIngest(
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
    const { events } = body;
    
    if (!Array.isArray(events) || events.length === 0) {
      return new Response(
        JSON.stringify({ error: 'Invalid request: events array required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }
    
    // Validate events structure
    for (const event of events) {
      if (!event.id || !event.type || !event.ts || !event.data || !event.meta) {
        return new Response(
          JSON.stringify({ error: 'Invalid event structure' }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
      }
    }
    
    // Transform events to database format
    const dbEvents = events.map((event) => ({
      id: event.id,
      type: event.type,
      ts: new Date(event.ts).toISOString(),
      participant_id: event.meta.pid,
      session_id: event.meta.sid,
      url: event.meta.url,
      viewport_width: event.meta.vw,
      viewport_height: event.meta.vh,
      timezone: event.meta.tz,
      data: event.data,
    }));
    
    // Insert into Supabase
    const supabase = createSupabaseClient(env);
    const { data, error } = await supabase
      .from('collection_events')
      .insert(dbEvents)
      .select('id');
    
    if (error) {
      console.error('Supabase insert error:', error);
      return new Response(
        JSON.stringify({ error: 'Failed to insert events', details: error.message }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }
    
    return new Response(
      JSON.stringify({ inserted: data?.length || events.length }),
      { 
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  } catch (error) {
    console.error('Ingest error:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
