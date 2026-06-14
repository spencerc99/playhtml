-- ABOUTME: Maintains daily_counts from recent collection_events windows on a schedule.
-- ABOUTME: Removes per-row daily count writes from the event ingest path.

CREATE EXTENSION IF NOT EXISTS pg_cron;

CREATE OR REPLACE FUNCTION public.refresh_recent_daily_counts(lookback_days integer DEFAULT 7)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  start_day date;
BEGIN
  IF lookback_days IS NULL OR lookback_days < 0 THEN
    RAISE EXCEPTION 'lookback_days must be a non-negative integer';
  END IF;

  start_day := current_date - lookback_days;

  DELETE FROM public.daily_counts
  WHERE day >= start_day;

  INSERT INTO public.daily_counts (day, type, count)
  SELECT date_trunc('day', ts)::date, type, count(*)
  FROM public.collection_events
  WHERE ts >= start_day::timestamptz
  GROUP BY 1, 2
  ON CONFLICT (day, type)
  DO UPDATE SET count = EXCLUDED.count;
END;
$$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM cron.job
    WHERE jobname = 'refresh_recent_daily_counts'
  ) THEN
    PERFORM cron.unschedule('refresh_recent_daily_counts');
  END IF;
END;
$$;

SELECT cron.schedule(
  'refresh_recent_daily_counts',
  '*/5 * * * *',
  $$SELECT public.refresh_recent_daily_counts(7);$$
);

DROP TRIGGER IF EXISTS trg_daily_count ON public.collection_events;
DROP FUNCTION IF EXISTS public.increment_daily_count();
