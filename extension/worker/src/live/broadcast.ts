// ABOUTME: Forwards renderable movement events to the LiveEventsHub durable object.
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
const LIVE_EVENT_TYPES = new Set(['cursor', 'viewport', 'keyboard']);
const REDACTED_GLYPH = '\u2588';

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function sanitizeLiveUrl(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;

  try {
    const url = new URL(value);
    url.username = '';
    url.password = '';
    url.search = '';
    url.hash = '';
    return url.toString();
  } catch {
    return undefined;
  }
}

function projectKeyboardStyle(value: unknown): UnknownRecord | undefined {
  if (!isRecord(value)) return undefined;

  const style: UnknownRecord = {};
  for (const key of ['w', 'h', 'br', 'bg', 'bs']) {
    if (typeof value[key] === 'number') style[key] = value[key];
  }
  return Object.keys(style).length > 0 ? style : undefined;
}

function projectKeyboardSequence(
  value: unknown,
): UnknownRecord[] | null | undefined {
  if (value === null) return null;
  if (!Array.isArray(value)) return undefined;

  return value.filter(isRecord).map((action) => {
    const projected: UnknownRecord = {};
    if (action.action === 'type' || action.action === 'backspace') {
      projected.action = action.action;
    }
    if (typeof action.timestamp === 'number') {
      projected.timestamp = action.timestamp;
    }
    if (typeof action.deletedCount === 'number') {
      projected.deletedCount = action.deletedCount;
    }
    if (typeof action.text === 'string') {
      projected.text = REDACTED_GLYPH.repeat([...action.text].length);
    }
    return projected;
  });
}

function projectKeyboardEvent(event: CollectionEvent): CollectionEvent {
  const source = isRecord(event.data) ? event.data : {};
  const data: UnknownRecord = {};

  if (typeof source.x === 'number') data.x = source.x;
  if (typeof source.y === 'number') data.y = source.y;
  if (source.event === 'type') data.event = source.event;

  const sequence = projectKeyboardSequence(source.sequence);
  if (sequence !== undefined) data.sequence = sequence;

  const style = projectKeyboardStyle(source.style);
  if (style) data.style = style;

  return { ...event, data };
}

function projectCursorEvent(event: CollectionEvent): CollectionEvent {
  const source = isRecord(event.data) ? event.data : {};
  const data: UnknownRecord = {};

  for (const key of [
    'x',
    'y',
    'scrollX',
    'scrollY',
    'button',
    'duration',
    'quantity',
  ]) {
    if (typeof source[key] === 'number') data[key] = source[key];
  }
  if (typeof source.cursor === 'string') data.cursor = source.cursor;
  if (
    source.event === 'move' ||
    source.event === 'click' ||
    source.event === 'hold' ||
    source.event === 'cursor_change'
  ) {
    data.event = source.event;
  }

  return { ...event, data };
}

function projectViewportEvent(event: CollectionEvent): CollectionEvent {
  const source = isRecord(event.data) ? event.data : {};
  const data: UnknownRecord = {};

  for (const key of [
    'scrollX',
    'scrollY',
    'scrollDistancePx',
    'width',
    'height',
    'zoom',
    'previous_zoom',
    'quantity',
  ]) {
    if (typeof source[key] === 'number') data[key] = source[key];
  }
  if (
    source.event === 'scroll' ||
    source.event === 'resize' ||
    source.event === 'zoom'
  ) {
    data.event = source.event;
  }

  return { ...event, data };
}

function projectLiveEvent(event: CollectionEvent): CollectionEvent {
  const projected =
    event.type === 'keyboard'
      ? projectKeyboardEvent(event)
      : event.type === 'cursor'
        ? projectCursorEvent(event)
        : projectViewportEvent(event);
  const normalizedUrl = sanitizeLiveUrl(projected.normalizedUrl);
  return {
    id: projected.id,
    type: projected.type,
    ts: projected.ts,
    data: projected.data,
    meta: {
      pid: projected.meta.pid,
      sid: projected.meta.sid,
      url: sanitizeLiveUrl(projected.meta.url) ?? '',
      vw: projected.meta.vw,
      vh: projected.meta.vh,
      tz: projected.meta.tz,
      cursor_color: projected.meta.cursor_color,
    },
    domain: projected.domain,
    normalizedUrl,
  };
}

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
  const liveEvents = events.filter((event) => LIVE_EVENT_TYPES.has(event.type));
  if (liveEvents.length === 0) return;

  try {
    const pids = [...new Set(liveEvents.map((event) => event.meta.pid))];
    const colors = await resolveCursorColors(env, pids, nowMs);

    const enriched = liveEvents.map(projectLiveEvent).map((e) => {
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
