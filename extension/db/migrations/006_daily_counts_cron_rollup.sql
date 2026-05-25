-- Replace the per-row daily_counts trigger with a periodic pg_cron rollup.
--
-- Background: migration 004 added trg_daily_count which runs an
-- INSERT ... ON CONFLICT DO UPDATE on daily_counts for EVERY insert into
-- collection_events. With ~270k events that's ~270k tiny UPDATEs on a
-- ~500-row table, driving constant autovacuum churn and WAL traffic.
--
-- Replacement strategy: a scheduled job recomputes counts for the last
-- 7 days every 5 minutes by aggregating collection_events directly.
-- Past days are immutable so we don't need to recompute them; very-late
-- syncs older than 7 days will be undercounted (acceptable for a
-- visualization heatmap).
--
-- The /events/daily-counts endpoint already reads from daily_counts, so
-- this change is invisible to the worker.

-- 1. Enable pg_cron (Supabase-managed, runs as the postgres role).
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- 2. Function: recompute daily_counts for the recent window.
CREATE OR REPLACE FUNCTION public.refresh_recent_daily_counts(lookback_days int DEFAULT 7)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  -- Aggregate recent events from collection_events (uses idx_events_ts).
  WITH recent AS (
    SELECT date_trunc('day', ts)::date AS day, type, count(*)::bigint AS count
    FROM collection_events
    WHERE ts >= (CURRENT_DATE - make_interval(days => lookback_days))
    GROUP BY 1, 2
  )
  INSERT INTO daily_counts (day, type, count)
  SELECT day, type, count FROM recent
  ON CONFLICT (day, type) DO UPDATE SET count = EXCLUDED.count;
END;
$$;

-- 3. Schedule the rollup every 5 minutes. Unschedule any previous version first.
DO $$
DECLARE
  jid bigint;
BEGIN
  SELECT jobid INTO jid FROM cron.job WHERE jobname = 'refresh_recent_daily_counts';
  IF jid IS NOT NULL THEN
    PERFORM cron.unschedule(jid);
  END IF;
END;
$$;

SELECT cron.schedule(
  'refresh_recent_daily_counts',
  '*/5 * * * *',
  $$SELECT public.refresh_recent_daily_counts(7);$$
);

-- 4. Drop the per-insert trigger and its function.
DROP TRIGGER IF EXISTS trg_daily_count ON collection_events;
DROP FUNCTION IF EXISTS public.increment_daily_count();

-- 5. Optional initial refresh. May take 30-60s on a multi-GB table; the cron
--    job will run it within 5 minutes regardless. Uncomment to run inline:
-- SELECT public.refresh_recent_daily_counts(7);
