// ABOUTME: Forwards newly ingested cursor events to the LiveEventsHub durable object.
// ABOUTME: Enriches events with participant cursor colors; fire-and-forget, never fails ingest.

import type { CollectionEvent } from '@playhtml/extension-types';
import { createSupabaseClient, type Env } from '../lib/supabase';
import { HUB_NAME } from './constants';

/**
 * Process-local cache of pid -> cursor color. Worker isolates are reused across
 * requests, so this avoids a Supabase lookup for every batch. Entries expire so
 * a participant who changes their color is picked up within the TTL.
 */
const COLOR_TTL_MS = 5 * 60 * 1000;
const colorCache = new Map<string, { color: string | null; at: number }>();

/** Fetch cursor colors for pids not in the cache (or whose cache entry expired),
 * then return a pid -> color map covering all requested pids. Best-effort: on
 * any failure, returns whatever is cached and leaves the rest uncolored. */
async function resolveCursorColors(
  env: Env,
  pids: string[],
  nowMs: number,
): Promise<Map<string, string | null>> {
  const result = new Map<string, string | null>();
  const missing: string[] = [];

  for (const pid of pids) {
    const cached = colorCache.get(pid);
    if (cached && nowMs - cached.at < COLOR_TTL_MS) {
      result.set(pid, cached.color);
    } else {
      missing.push(pid);
    }
  }

  if (missing.length > 0) {
    try {
      const supabase = createSupabaseClient(env);
      const { data } = await supabase
        .from('participants')
        .select('pid, cursor_color')
        .in('pid', missing);

      const found = new Map<string, string | null>();
      for (const row of data ?? []) {
        found.set(row.pid as string, (row.cursor_color as string) ?? null);
      }
      // Record every requested-but-missing pid (even those with no row) so we
      // don't re-query for participants who simply have no stored color.
      for (const pid of missing) {
        const color = found.get(pid) ?? null;
        colorCache.set(pid, { color, at: nowMs });
        result.set(pid, color);
      }
      // Sweep expired entries so the cache can't grow without bound over the
      // isolate's lifetime as new participants appear.
      for (const [pid, entry] of colorCache) {
        if (nowMs - entry.at >= COLOR_TTL_MS) colorCache.delete(pid);
      }
    } catch (err) {
      console.warn('[broadcast] cursor color lookup failed:', err);
    }
  }

  return result;
}

export async function broadcastLiveEvents(
  namespace: DurableObjectNamespace,
  env: Env,
  events: CollectionEvent[],
  nowMs: number,
): Promise<void> {
  const cursorEvents = events.filter((e) => e.type === 'cursor');
  if (cursorEvents.length === 0) return;

  try {
    const pids = [...new Set(cursorEvents.map((e) => e.meta.pid))];
    const colors = await resolveCursorColors(env, pids, nowMs);

    const enriched = cursorEvents.map((e) => {
      const color = colors.get(e.meta.pid);
      if (!color) return e;
      return { ...e, meta: { ...e.meta, cursor_color: color } };
    });

    const id = namespace.idFromName(HUB_NAME);
    const stub = namespace.get(id);
    await stub.fetch(
      new Request('https://do/broadcast', {
        method: 'POST',
        body: JSON.stringify({ events: enriched }),
      }),
    );
  } catch (err) {
    console.warn('[broadcast] live event forward failed:', err);
  }
}
