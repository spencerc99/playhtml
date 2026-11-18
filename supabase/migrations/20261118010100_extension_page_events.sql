-- ABOUTME: Lets the Worker page through one page's events (any type) newest first through the page URL index.
-- ABOUTME: Uses the existing idx_events_urlhash_ts on (md5(url), ts DESC); creates and drops no index.

-- One page of events whose md5(url) is any of p_url_hashes (at most 4 lowercase hex md5
-- digests; anything else in the array is ignored), newest first, strictly before the
-- (p_before_ts, p_before_id) cursor. Callers pass the last row of the previous page. Each
-- hash is read through its own ordered index range, so the final sort only sees p_limit
-- rows per hash.
--
-- Callers send hashes rather than URLs so a reader's page URL never reaches the Worker.
-- There is no exact-url recheck: two different URLs with the same md5 would share their
-- events here, which is acceptable for showing trails.
--
-- The index has no type column: a type that is rare on a busy page is found by reading
-- that page's rows newest first until enough match.
--
-- Bitmap scans are turned off for the call: when the planner misjudges a hash as rare it
-- can pick a bitmap scan, which reads and sorts every row of a busy page on each call.
-- The ordered index scan stops after p_limit rows.
CREATE OR REPLACE FUNCTION public.page_events_page(
  p_url_hashes text[],
  p_type text DEFAULT NULL,
  p_from timestamptz DEFAULT NULL,
  p_to timestamptz DEFAULT NULL,
  p_before_ts timestamptz DEFAULT 'infinity',
  p_before_id text DEFAULT '',
  p_limit integer DEFAULT 1000
)
RETURNS SETOF public.collection_events
LANGUAGE sql
STABLE
SET search_path = ''
SET enable_bitmapscan = off
AS $$
  SELECT page.*
  FROM (
    SELECT DISTINCT h
    FROM unnest(p_url_hashes[1:4]) AS h
    WHERE h ~ '^[0-9a-f]{32}$'
  ) AS target(url_hash)
  CROSS JOIN LATERAL (
    SELECT e.*
    FROM public.collection_events e
    WHERE md5(e.url) = target.url_hash
      AND (p_type IS NULL OR e.type = p_type)
      AND (p_from IS NULL OR e.ts >= p_from)
      AND (p_to IS NULL OR e.ts <= p_to)
      AND e.ts <= p_before_ts
      AND (e.ts, e.id) < (p_before_ts, p_before_id)
    ORDER BY e.ts DESC, e.id DESC
    LIMIT least(greatest(p_limit, 1), 1000)
  ) AS page
  ORDER BY page.ts DESC, page.id DESC
  LIMIT least(greatest(p_limit, 1), 1000)
$$;

-- Only the Worker (service role) reads events through this function.
REVOKE ALL ON FUNCTION public.page_events_page(text[], text, timestamptz, timestamptz, timestamptz, text, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.page_events_page(text[], text, timestamptz, timestamptz, timestamptz, text, integer)
  TO service_role;
