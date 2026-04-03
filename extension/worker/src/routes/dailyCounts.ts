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

    // Query the pre-computed daily_counts table (populated by trigger on insert)
    let query = supabase
      .from('daily_counts')
      .select('day, count');

    if (type) {
      query = query.eq('type', type);
    }
    if (from) {
      query = query.gte('day', from);
    }
    if (to) {
      query = query.lte('day', to);
    }

    const { data: rows, error } = await query.order('day', { ascending: true });

    if (error) {
      console.error('daily_counts query error:', error);
      return new Response(
        JSON.stringify({ error: 'Failed to fetch daily counts', details: error.message }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // If no type filter, aggregate all types per day
    let result: { day: string; count: number }[];
    if (!type) {
      const byDay = new Map<string, number>();
      for (const row of rows ?? []) {
        byDay.set(row.day, (byDay.get(row.day) ?? 0) + row.count);
      }
      result = [...byDay.entries()]
        .map(([day, count]) => ({ day, count }))
        .sort((a, b) => a.day.localeCompare(b.day));
    } else {
      result = (rows ?? []).map((r) => ({ day: r.day, count: r.count }));
    }

    return new Response(
      JSON.stringify(result),
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
