// ABOUTME: Serves daily event counts for the movement page calendar heatmap.
// ABOUTME: Public endpoint calling the daily_event_counts Supabase RPC function.

import { createSupabaseClient, type Env } from '../lib/supabase';

/**
 * GET /events/daily-counts
 * Returns event counts grouped by day for the calendar heatmap.
 * Public endpoint (no auth required).
 *
 * Query parameters:
 * - type: Event type filter (optional)
 * - from: ISO date string, inclusive lower bound (optional)
 * - to: ISO date string, inclusive upper bound (optional)
 */
export async function handleDailyCounts(
  request: Request,
  env: Env
): Promise<Response> {
  try {
    const url = new URL(request.url);
    const type = url.searchParams.get('type') || null;
    const from = url.searchParams.get('from') || null;
    const to = url.searchParams.get('to') || null;

    const supabase = createSupabaseClient(env);

    const { data, error } = await supabase.rpc('daily_event_counts', {
      event_type: type,
      from_date: from,
      to_date: to,
    });

    if (error) {
      console.error('daily_event_counts RPC error:', error);
      return new Response(
        JSON.stringify({ error: 'Failed to fetch daily counts', details: error.message }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify(data ?? []),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      }
    );
  } catch (error) {
    console.error('Daily counts error:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
