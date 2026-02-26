import { createSupabaseClient, type Env } from '../lib/supabase';
import { VERBOSE } from '../config';
import {
  getValidEventTypes,
  type CollectionEventType,
  type PageMetadataSnapshot,
} from '../../../src/shared/types';

// Rate limiting: max events per request
const MAX_EVENTS_PER_REQUEST = 500;

interface IngestEvent {
  id: string;
  type: CollectionEventType;
  ts: number;
  data: unknown;
  meta: {
    pid: string;
    sid: string;
    url?: string;
    vw?: number;
    vh?: number;
    tz?: string;
  };
}

interface NavigationLikeData {
  page_ref?: unknown;
  canonical_url?: unknown;
  title?: unknown;
  favicon_url?: unknown;
  metadata_hash?: unknown;
  [key: string]: unknown;
}

interface CurrentMetadataRow {
  id: string;
  page_ref: string;
  metadata_hash: string;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function extractPageMetadataSnapshot(event: IngestEvent): PageMetadataSnapshot | null {
  if (event.type !== 'navigation' || !isObject(event.data)) {
    return null;
  }

  const data = event.data as NavigationLikeData;
  if (
    typeof data.page_ref !== 'string' ||
    typeof data.canonical_url !== 'string' ||
    typeof data.title !== 'string' ||
    typeof data.favicon_url !== 'string' ||
    typeof data.metadata_hash !== 'string'
  ) {
    return null;
  }

  return {
    page_ref: data.page_ref,
    canonical_url: data.canonical_url,
    title: data.title,
    favicon_url: data.favicon_url,
    metadata_hash: data.metadata_hash,
    observed_at_ts: event.ts,
  };
}

function stripNavigationMetadata(event: IngestEvent): unknown {
  if (event.type !== 'navigation' || !isObject(event.data)) {
    return event.data;
  }

  const { title, favicon_url, canonical_url, metadata_hash, ...rest } = event.data as NavigationLikeData;
  void title;
  void favicon_url;
  void canonical_url;
  void metadata_hash;
  return rest;
}

async function persistPageMetadataHistory(
  supabase: ReturnType<typeof createSupabaseClient>,
  snapshots: PageMetadataSnapshot[]
): Promise<number> {
  if (snapshots.length === 0) {
    return 0;
  }

  const sortedSnapshots = [...snapshots].sort((a, b) => a.observed_at_ts - b.observed_at_ts);
  const refs = [...new Set(sortedSnapshots.map((s) => s.page_ref))];
  const currentByRef = new Map<string, CurrentMetadataRow>();

  const { data: currentRows, error: currentError } = await supabase
    .from('page_metadata_history')
    .select('id, page_ref, metadata_hash')
    .in('page_ref', refs)
    .is('valid_to_ts', null);

  if (currentError) {
    throw currentError;
  }

  for (const row of (currentRows || []) as CurrentMetadataRow[]) {
    currentByRef.set(row.page_ref, row);
  }

  let insertedCount = 0;

  for (const snapshot of sortedSnapshots) {
    const current = currentByRef.get(snapshot.page_ref);
    if (current && current.metadata_hash === snapshot.metadata_hash) {
      continue;
    }

    if (current) {
      const { error: closeError } = await supabase
        .from('page_metadata_history')
        .update({ valid_to_ts: new Date(snapshot.observed_at_ts).toISOString() })
        .eq('id', current.id);
      if (closeError) {
        throw closeError;
      }
    }

    const { data: insertedRow, error: insertError } = await supabase
      .from('page_metadata_history')
      .insert({
        page_ref: snapshot.page_ref,
        canonical_url: snapshot.canonical_url,
        title: snapshot.title,
        favicon_url: snapshot.favicon_url,
        metadata_hash: snapshot.metadata_hash,
        valid_from_ts: new Date(snapshot.observed_at_ts).toISOString(),
        valid_to_ts: null,
      })
      .select('id, page_ref, metadata_hash')
      .single();

    if (insertError) {
      throw insertError;
    }

    currentByRef.set(snapshot.page_ref, insertedRow as CurrentMetadataRow);
    insertedCount++;
  }

  return insertedCount;
}

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
    const { events } = body as { events?: unknown };
    
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
    
    const typedEvents = events as IngestEvent[];
    const metadataSnapshots: PageMetadataSnapshot[] = [];

    // Validate events structure and extract metadata snapshots.
    for (const event of typedEvents) {
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

      const snapshot = extractPageMetadataSnapshot(event);
      if (snapshot) {
        metadataSnapshots.push(snapshot);
      }
    }
    
    // Transform events to database format
    const dbEvents = typedEvents.map((event) => ({
      id: event.id,
      type: event.type,
      ts: new Date(event.ts).toISOString(),
      participant_id: event.meta.pid,
      session_id: event.meta.sid,
      url: event.meta.url,
      viewport_width: event.meta.vw,
      viewport_height: event.meta.vh,
      timezone: event.meta.tz,
      // Keep event rows lean: title/favicon history is stored in page_metadata_history.
      data: stripNavigationMetadata(event),
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
    const duplicates = typedEvents.length - inserted;

    // Best effort: persist page metadata history.
    // If table doesn't exist yet, ingest still succeeds and event data remains valid.
    let pageMetadataInserted = 0;
    if (metadataSnapshots.length > 0) {
      try {
        pageMetadataInserted = await persistPageMetadataHistory(supabase, metadataSnapshots);
      } catch (metadataError) {
        console.warn('[Ingest] Page metadata history write skipped:', metadataError);
      }
    }
    
    if (VERBOSE && duplicates > 0) {
      console.log(`[Ingest] Inserted ${inserted} new events, ${duplicates} duplicates ignored`);
    }
    
    return new Response(
      JSON.stringify({ inserted, duplicates, page_metadata_inserted: pageMetadataInserted }),
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
