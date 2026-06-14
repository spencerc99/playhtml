// ABOUTME: Plans collection_events archive windows for the scheduled Worker.
// ABOUTME: Records dry-run manifest rows without exporting or deleting event data.

import { createSupabaseClient, type Env } from '../lib/supabase';

const DEFAULT_RETENTION_DAYS = 60;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const MS_PER_HOUR = 60 * 60 * 1000;

export type CollectionEventsArchiveResult =
  | {
      status: 'planned';
      eventType: string;
      rowCount: number;
      windowStart: string;
      windowEnd: string;
      r2Key: string;
    }
  | {
      status: 'skipped';
      reason: 'disabled' | 'no_eligible_events';
    };

export interface CollectionEventsArchiveOptions {
  now?: Date;
  retentionDays?: number;
}

interface OldestEligibleEvent {
  id: string;
  type: string;
  ts: string;
}

export async function planCollectionEventsArchiveIfEnabled(
  env: Env,
): Promise<CollectionEventsArchiveResult> {
  if (env.COLLECTION_EVENTS_ARCHIVE_ENABLED !== 'true') {
    return { status: 'skipped', reason: 'disabled' };
  }

  return planCollectionEventsArchive(env);
}

export function scheduleCollectionEventsArchive(env: Env, ctx: ExecutionContext): void {
  ctx.waitUntil(
    planCollectionEventsArchiveIfEnabled(env)
      .then((result) => {
        if (result.status === 'planned') {
          console.log(
            `[archive] planned ${result.rowCount} ${result.eventType} events for ${result.windowStart}`,
          );
        }
        return result;
      })
      .catch((error) => {
        console.error('[archive] collection_events planning failed:', error);
        throw error;
      }),
  );
}

export async function planCollectionEventsArchive(
  env: Env,
  options: CollectionEventsArchiveOptions = {},
): Promise<CollectionEventsArchiveResult> {
  const now = options.now ?? new Date();
  const retentionDays =
    options.retentionDays ?? parseRetentionDays(env.COLLECTION_EVENTS_ARCHIVE_RETENTION_DAYS);
  const cutoff = truncateToHour(new Date(now.getTime() - retentionDays * MS_PER_DAY));
  const cutoffIso = cutoff.toISOString();
  const supabase = createSupabaseClient(env);

  const { data: oldest, error: oldestError } = await supabase
    .from('collection_events')
    .select('id, type, ts')
    .lt('ts', cutoffIso)
    .order('ts', { ascending: true })
    .order('type', { ascending: true })
    .order('id', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (oldestError) {
    throw new Error(`Failed to find archive window: ${oldestError.message}`);
  }
  if (!oldest) {
    return { status: 'skipped', reason: 'no_eligible_events' };
  }

  const event = assertOldestEligibleEvent(oldest);
  const windowStart = truncateToHour(new Date(event.ts));
  const windowEnd = new Date(windowStart.getTime() + MS_PER_HOUR);
  const windowStartIso = windowStart.toISOString();
  const windowEndIso = windowEnd.toISOString();

  const { count, error: countError } = await supabase
    .from('collection_events')
    .select('id', { count: 'exact', head: true })
    .eq('type', event.type)
    .gte('ts', windowStartIso)
    .lt('ts', windowEndIso);

  if (countError) {
    throw new Error(`Failed to count archive window: ${countError.message}`);
  }
  if (count === null || count === undefined) {
    throw new Error('Archive window count was not returned');
  }

  const rowCount = count;
  const r2Key = archiveObjectKey({
    eventType: event.type,
    windowStart,
    windowEnd,
  });

  const { error: upsertError } = await supabase
    .from('collection_event_archives')
    .upsert(
      {
        status: 'planned',
        event_type: event.type,
        window_start: windowStartIso,
        window_end: windowEndIso,
        r2_key: r2Key,
        row_count: rowCount,
        byte_count: 0,
      },
      { onConflict: 'r2_key' },
    );

  if (upsertError) {
    throw new Error(`Failed to write archive manifest: ${upsertError.message}`);
  }

  return {
    status: 'planned',
    eventType: event.type,
    rowCount,
    windowStart: windowStartIso,
    windowEnd: windowEndIso,
    r2Key,
  };
}

function parseRetentionDays(value: string | undefined): number {
  if (value === undefined || value.trim() === '') return DEFAULT_RETENTION_DAYS;

  const days = Number(value);
  if (!Number.isInteger(days) || days <= 0) {
    throw new Error('COLLECTION_EVENTS_ARCHIVE_RETENTION_DAYS must be a positive integer');
  }

  return days;
}

function assertOldestEligibleEvent(value: unknown): OldestEligibleEvent {
  if (!value || typeof value !== 'object') {
    throw new Error('Archive window query returned an invalid row');
  }

  const event = value as Partial<OldestEligibleEvent>;
  if (
    typeof event.id !== 'string' ||
    typeof event.type !== 'string' ||
    typeof event.ts !== 'string'
  ) {
    throw new Error('Archive window query returned an invalid row');
  }

  return { id: event.id, type: event.type, ts: event.ts };
}

function truncateToHour(date: Date): Date {
  return new Date(Math.floor(date.getTime() / MS_PER_HOUR) * MS_PER_HOUR);
}

function archiveObjectKey({
  eventType,
  windowStart,
  windowEnd,
}: {
  eventType: string;
  windowStart: Date;
  windowEnd: Date;
}): string {
  const day = windowStart.toISOString().slice(0, 10);
  const safeType = encodeURIComponent(eventType);
  return [
    `collection-events/type=${safeType}`,
    `day=${day}`,
    `chunk=${keyTimestamp(windowStart)}_${keyTimestamp(windowEnd)}.jsonl.gz`,
  ].join('/');
}

function keyTimestamp(date: Date): string {
  return date.toISOString().replace(/[:.]/g, '-');
}
