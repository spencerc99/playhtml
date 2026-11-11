// ABOUTME: Handles bulk export of collected event data as JSON.
// ABOUTME: Admin-authenticated endpoint for extracting edition data from Supabase.

import { createSupabaseClient, type Env } from '../lib/supabase';
import { getLaterEventFilter } from '../lib/eventCursorFilter';
import { getAdminAuthError } from '../lib/adminAuth';
import type { CollectionEvent, EventMeta } from '@playhtml/extension-types';

const EXPORT_PAGE_SIZE = 1000;

interface ExportEventCursor {
  ts: string;
  id: string;
}

interface ExportEventRow {
  id: string;
  type: CollectionEvent['type'];
  ts: string;
  data: unknown;
  participant_id: string;
  session_id: string;
  url: string;
  viewport_width: number;
  viewport_height: number;
  timezone: string;
}

interface ExportEventPage {
  data: ExportEventRow[] | null;
  error: { message: string } | null;
}

type ExportEventRows =
  | { rows: ExportEventRow[]; error: null }
  | { rows: null; error: { message: string } };

interface ExportRequestBody {
  type?: string;
  startDate?: string;
  endDate?: string;
  name?: string;
}

export async function loadExportEventRows(
  loadPage: (
    cursor: ExportEventCursor | null,
    pageSize: number,
  ) => Promise<ExportEventPage>,
): Promise<ExportEventRows> {
  const rows: ExportEventRow[] = [];
  let cursor: ExportEventCursor | null = null;

  while (true) {
    const result = await loadPage(cursor, EXPORT_PAGE_SIZE);
    if (result.error) return { rows: null, error: result.error };

    const page = result.data ?? [];
    rows.push(...page);
    if (page.length < EXPORT_PAGE_SIZE) break;

    const lastRow = page.at(-1);
    if (typeof lastRow?.ts !== 'string' || typeof lastRow.id !== 'string') {
      throw new Error('Export event row is missing pagination fields');
    }
    cursor = { ts: lastRow.ts, id: lastRow.id };
  }

  return { rows, error: null };
}

/**
 * POST /events/export
 * Export edition data to JSON format
 * 
 * SECURITY: Requires ADMIN_KEY authentication.
 * Protects bulk export of user-collected data.
 */
export async function handleExport(
  request: Request,
  env: Env
): Promise<Response> {
  const authError = getAdminAuthError(request, env.ADMIN_KEY);
  if (authError) return authError;
  
  try {
    const body = await request.json() as ExportRequestBody;
    const { type, startDate, endDate, name } = body;
    
    if (!type || !startDate || !endDate) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields: type, startDate, endDate' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }
    
    const supabase = createSupabaseClient(env);

    const { rows: data, error } = await loadExportEventRows(async (cursor, pageSize) => {
      let query = supabase
        .from('collection_events')
        .select('*')
        .eq('type', type)
        .gte('ts', startDate)
        .lt('ts', endDate);

      if (cursor) {
        query = query.or(getLaterEventFilter(cursor.ts, cursor.id));
      }

      const { data: pageData, error } = await query
        .order('ts', { ascending: true })
        .order('id', { ascending: true })
        .limit(pageSize);

      return {
        data: pageData as ExportEventRow[] | null,
        error,
      };
    });

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
    const events: CollectionEvent[] = (data || []).map((row) => ({
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
      } as EventMeta,
    }));
    
    const edition = {
      name: name || `Internet Movement ${new Date(startDate).toLocaleDateString()}`,
      type,
      startDate,
      endDate,
      participantCount: participants.size,
      eventCount: data.length,
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
