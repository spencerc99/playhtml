// ABOUTME: Handles ingestion of collected browsing events from the extension.
// ABOUTME: Validates, rate-limits, and stores event batches in Supabase with page metadata.

import { createSupabaseClient, type Env } from '../lib/supabase';
import {
  getValidEventTypes,
  type CollectionEventType,
  type CollectionEvent,
  type PageMetadataSnapshot,
} from '@playhtml/extension-types';
import { broadcastLiveEvents } from '../live/broadcast';

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

/**
 * The snapshots the metadata RPC needs, in observation order. Consecutive
 * snapshots of one page with the same metadata_hash collapse to the first and
 * last of the run: the RPC opens a history row at the first and only advances
 * latest_observed_at_ts for the rest, so the dropped middle calls change
 * nothing. A page that leaves a hash and returns to it keeps both runs.
 */
export function collapsePageMetadataSnapshots(
  snapshots: PageMetadataSnapshot[],
): PageMetadataSnapshot[] {
  const sorted = [...snapshots].sort((a, b) => a.observed_at_ts - b.observed_at_ts);
  const runsByPage = new Map<string, PageMetadataSnapshot[][]>();
  const order: PageMetadataSnapshot[][] = [];
  for (const snapshot of sorted) {
    const runs = runsByPage.get(snapshot.page_ref) ?? [];
    const run = runs.at(-1);
    if (run && run[0].metadata_hash === snapshot.metadata_hash) {
      run.push(snapshot);
    } else {
      const next = [snapshot];
      runs.push(next);
      order.push(next);
    }
    runsByPage.set(snapshot.page_ref, runs);
  }
  const collapsed: PageMetadataSnapshot[] = [];
  for (const run of order) {
    collapsed.push(run[0]);
    const last = run.at(-1)!;
    if (last !== run[0] && last.observed_at_ts !== run[0].observed_at_ts) collapsed.push(last);
  }
  return collapsed.sort((a, b) => a.observed_at_ts - b.observed_at_ts);
}

/** Writes snapshots one at a time, oldest first; the RPC ignores any older than what it has. */
async function persistPageMetadataHistory(
  supabase: ReturnType<typeof createSupabaseClient>,
  snapshots: PageMetadataSnapshot[]
): Promise<number> {
  let insertedCount = 0;
  for (const snapshot of snapshots) {
    const { data: inserted, error } = await supabase.rpc('record_page_metadata_snapshot', {
      p_page_ref: snapshot.page_ref,
      p_canonical_url: snapshot.canonical_url,
      p_title: snapshot.title,
      p_favicon_url: snapshot.favicon_url,
      p_metadata_hash: snapshot.metadata_hash,
      p_observed_at_ts: new Date(snapshot.observed_at_ts).toISOString(),
    });

    if (error) {
      throw error;
    }

    if (inserted) {
      insertedCount++;
    }
  }

  return insertedCount;
}

/** Page URL schemes the content script runs on: web pages, and local files when the user allows it. */
const INGEST_URL_PROTOCOLS = new Set(['http:', 'https:', 'file:']);

/** Largest |ms| a JavaScript Date can hold. */
const MAX_DATE_MS = 8.64e15;

/** Why event `index` is unacceptable, or null when it is a well-formed event. */
export function ingestEventProblem(event: unknown, index: number, validTypes: string[]): string | null {
  if (!isObject(event)) return `Invalid event at index ${index}: not an object`;
  const { id, type, ts, data, meta } = event;
  if (!id || !type || !ts || !data || !isObject(meta)) {
    return `Invalid event structure at index ${index}`;
  }
  if (!validTypes.includes(type as string)) {
    return `Invalid event type at index ${index}: ${String(type)}`;
  }
  if (typeof ts !== 'number' || !Number.isFinite(ts) || Math.abs(ts) > MAX_DATE_MS) {
    return `Invalid ts at index ${index}: expected epoch milliseconds`;
  }
  if (!meta.pid || !meta.sid) {
    return `Invalid meta at index ${index}: pid and sid required`;
  }
  if (meta.url !== undefined) {
    let protocol: string | null = null;
    if (typeof meta.url === 'string') {
      try {
        protocol = new URL(meta.url).protocol;
      } catch {
        protocol = null;
      }
    }
    if (protocol === null || !INGEST_URL_PROTOCOLS.has(protocol)) {
      return `Invalid meta.url at index ${index}: expected an http(s) or file URL`;
    }
  }
  return null;
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
 *
 * Response: { inserted, duplicates, page_metadata_queued }. `inserted` is the
 * batch length (duplicates are ignored by the upsert and not counted apart).
 * `page_metadata_queued` is how many page metadata snapshots were handed to
 * the background history write, not how many rows it changed.
 */
export async function handleIngest(
  request: Request,
  env: Env,
  ctx: ExecutionContext
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
    
    // Validate every event before storing any; a 400 names the first bad index.
    const validTypes = getValidEventTypes();
    for (let index = 0; index < events.length; index++) {
      const problem = ingestEventProblem(events[index], index, validTypes);
      if (problem) {
        return new Response(
          JSON.stringify({ error: problem }),
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

    const typedEvents = events as IngestEvent[];
    const metadataSnapshots: PageMetadataSnapshot[] = [];
    for (const event of typedEvents) {
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
    const { error } = await supabase
      .from('collection_events')
      .upsert(dbEvents, {
        onConflict: 'id',
        ignoreDuplicates: true,
      });
    
    if (error) {
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
    
    const inserted = typedEvents.length;

    // Best effort: page metadata history is written after the response is
    // sent. A failed write leaves the event rows intact.
    const pageMetadataSnapshots = collapsePageMetadataSnapshots(metadataSnapshots);
    if (pageMetadataSnapshots.length > 0) {
      ctx.waitUntil(
        persistPageMetadataHistory(supabase, pageMetadataSnapshots).catch((metadataError) => {
          console.warn('[Ingest] Page metadata history write skipped:', metadataError);
        }),
      );
    }

    // Fan out renderable movement and navigation events to the live stream. Fire-and-forget
    // must never affect the ingest result. Live consumers tolerate optional
    // metadata fields being absent.
    ctx.waitUntil(
      broadcastLiveEvents(
        env.LIVE_EVENTS_HUB,
        env,
        typedEvents as unknown as CollectionEvent[],
        Date.now(),
      ),
    );

    return new Response(
      JSON.stringify({ inserted, duplicates: 0, page_metadata_queued: pageMetadataSnapshots.length }),
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
