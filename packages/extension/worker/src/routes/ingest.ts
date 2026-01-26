import { createSupabaseClient, type Env } from '../lib/supabase';
import { VERBOSE } from '../config';
import { getValidEventTypes, type CollectionEventType } from '../../../src/shared/types';

// Rate limiting: max events per request
const MAX_EVENTS_PER_REQUEST = 500;

/**
 * POST /events
 * Batch insert events from extension
 * 
 * SECURITY: This endpoint is PUBLIC (no auth required) because:
 * - Extension code is client-side, so any API key would be visible anyway
 * - We protect via: validation, rate limits, and data anonymity
 * 
 * Protections in place:
 * - Rate limit: max 500 events per request
 * - Validation: strict event type and structure checks
 * - No PII: participant IDs are anonymous, randomly generated
 * 
 * The admin endpoints (stats, export) ARE protected with ADMIN_KEY
 * to prevent unauthorized access to aggregated user data.
 */
export async function handleIngest(
  request: Request,
  env: Env
): Promise<Response> {
  try {
    const body = await request.json();
    const { events } = body;
    
    if (!Array.isArray(events) || events.length === 0) {
      return new Response(
        JSON.stringify({ error: 'Invalid request: events array required' }),
        { 
          status: 400, 
          headers: { 
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          }
        }
      );
    }
    
    // Rate limit: max events per request
    if (events.length > MAX_EVENTS_PER_REQUEST) {
      return new Response(
        JSON.stringify({ error: `Too many events. Max ${MAX_EVENTS_PER_REQUEST} per request` }),
        { 
          status: 400, 
          headers: { 
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          }
        }
      );
    }
    
    // Validate events structure
    for (const event of events) {
      if (!event.id || !event.type || !event.ts || !event.data || !event.meta) {
        return new Response(
          JSON.stringify({ error: 'Invalid event structure' }),
          { 
            status: 400, 
            headers: { 
              'Content-Type': 'application/json',
              'Access-Control-Allow-Origin': '*',
            }
          }
        );
      }
      
      // Validate event type
      const validTypes = getValidEventTypes();
      if (!validTypes.includes(event.type as CollectionEventType)) {
        return new Response(
          JSON.stringify({ error: `Invalid event type: ${event.type}` }),
          { 
            status: 400, 
            headers: { 
              'Content-Type': 'application/json',
              'Access-Control-Allow-Origin': '*',
            }
          }
        );
      }
      
      // Validate meta structure
      const { meta } = event;
      if (!meta.pid || !meta.sid) {
        return new Response(
          JSON.stringify({ error: 'Invalid meta: pid and sid required' }),
          { 
            status: 400, 
            headers: { 
              'Content-Type': 'application/json',
              'Access-Control-Allow-Origin': '*',
            }
          }
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
    // Use upsert with ignoreDuplicates to handle retries gracefully
    const supabase = createSupabaseClient(env);
    const { data, error } = await supabase
      .from('collection_events')
      .upsert(dbEvents, {
        onConflict: 'id',
        ignoreDuplicates: true,
      })
      .select('id');
    
    if (error) {
      // Check if it's a duplicate key error (shouldn't happen with upsert, but just in case)
      if (error.code === '23505') {
        // Duplicate key - treat as success (events already exist)
        if (VERBOSE) {
          console.log(`[Ingest] ${events.length} events already exist (duplicates ignored)`);
        }
        return new Response(
          JSON.stringify({ inserted: 0, duplicates: events.length }),
          { 
            status: 200,
            headers: { 
              'Content-Type': 'application/json',
              'Access-Control-Allow-Origin': '*',
            }
          }
        );
      }
      
      console.error('Supabase insert error:', error);
      return new Response(
        JSON.stringify({ error: 'Failed to insert events', details: error.message }),
        { 
          status: 500, 
          headers: { 
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          }
        }
      );
    }
    
    // Count how many were actually inserted (data.length) vs duplicates
    const inserted = data?.length || 0;
    const duplicates = events.length - inserted;
    
    if (VERBOSE && duplicates > 0) {
      console.log(`[Ingest] Inserted ${inserted} new events, ${duplicates} duplicates ignored`);
    }
    
    return new Response(
      JSON.stringify({ inserted, duplicates }),
      { 
        status: 200,
        headers: { 
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        }
      }
    );
  } catch (error) {
    console.error('Ingest error:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { 
        status: 500, 
        headers: { 
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        }
      }
    );
  }
}
