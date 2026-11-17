-- ABOUTME: Limits the page metadata and page trails functions to the Worker and removes the unused daily counts function.
-- ABOUTME: The Worker reads daily totals from the daily_counts table, so daily_event_counts has no callers.

-- Functions in public are granted to anon and authenticated by default. The Worker
-- (service role) is the only caller of these two.
REVOKE ALL ON FUNCTION public.record_page_metadata_snapshot(text, text, text, text, text, timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_page_metadata_snapshot(text, text, text, text, text, timestamptz)
  TO service_role;

REVOKE ALL ON FUNCTION public.get_url_trails(text, timestamptz, text, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_url_trails(text, timestamptz, text, integer)
  TO service_role;

DROP FUNCTION IF EXISTS public.daily_event_counts(text, timestamptz, timestamptz);
