import { createSupabaseClient, type Env } from '../lib/supabase';

/**
 * GET /events/stats
 * Get statistics for admin dashboard
 * Requires API key authentication
 */
export async function handleStats(
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
    const url = new URL(request.url);
    const type = url.searchParams.get('type') || null;
    
    const supabase = createSupabaseClient(env);
    
    // Build query
    let query = supabase.from('collection_events').select('*', { count: 'exact', head: true });
    
    if (type) {
      query = query.eq('type', type);
    }
    
    const { count, error: countError } = await query;
    
    if (countError) {
      console.error('Supabase count error:', countError);
      return new Response(
        JSON.stringify({ error: 'Failed to fetch stats', details: countError.message }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }
    
    // Get unique participant count
    const { data: participants, error: participantsError } = await supabase
      .from('collection_events')
      .select('participant_id')
      .limit(10000); // Reasonable limit
    
    if (participantsError) {
      console.error('Supabase participants error:', participantsError);
    }
    
    const uniqueParticipants = new Set(
      (participants || []).map((p) => p.participant_id)
    ).size;
    
    // Get oldest event timestamp
    const { data: oldest, error: oldestError } = await supabase
      .from('collection_events')
      .select('ts')
      .order('ts', { ascending: true })
      .limit(1)
      .single();
    
    return new Response(
      JSON.stringify({
        count: count || 0,
        participants: uniqueParticipants,
        since: oldest?.ts || null,
        type: type || 'all',
      }),
      { 
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  } catch (error) {
    console.error('Stats error:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
