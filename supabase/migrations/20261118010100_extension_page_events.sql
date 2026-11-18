-- ABOUTME: Lets the Worker page through one page's events of one type, newest first, by md5(url).
-- ABOUTME: Reads through idx_events_urlhash_type_ts on (md5(url), type, ts DESC) from the previous migration.

-- One page of events of type p_type whose md5(url) is any of p_url_hashes (at most 4
-- lowercase hex md5 digests; anything else in the array is ignored), newest first,
-- strictly before the (p_before_ts, p_before_id) cursor. Callers pass the last row of the
-- previous page. Each hash is read through its own ordered range of the index, so the
-- final sort only sees p_limit rows per hash.
--
-- Callers send hashes rather than URLs so a reader's page URL never reaches the Worker.
-- There is no exact-url recheck: two different URLs with the same md5 would share their
-- events here, which is acceptable for showing trails.
--
-- Every read names one type. The hash and the type are equality conditions on the
-- index's first two columns, so its ts column returns that type's rows already in order,
-- and a type that is rare on a busy page reads only its own rows. A null p_type matches
-- no rows: an any-type read could not come back in ts order from this index and would
-- sort the page's whole history. The time bounds and the cursor's timestamp are written
-- as plain comparisons on ts so they bound the index range instead of filtering rows
-- after reading them; the (ts, id) comparison only filters the cursor's own timestamp.
--
-- Three planner settings hold the call to that plan. The hash comes from the unnest join,
-- so the planner costs every page as a tiny one and on its own picks a full sort of the
-- page's rows of that type, which on a busy page reads all of them on every call.
-- enable_sort = off makes it order each run of equal timestamps by id with an incremental
-- sort instead, which stops one row past p_limit. That setting works by adding a large
-- cost to the plan, which would also switch on JIT compilation (hundreds of milliseconds
-- per call), so jit is off. Bitmap scans are off as well: a bitmap scan returns rows out
-- of order, so it would read and sort every row of that type, and the planner can pick
-- one when it misjudges a page's size.
CREATE OR REPLACE FUNCTION public.page_events_page(
  p_url_hashes text[],
  p_type text,
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
SET enable_sort = off
SET jit = off
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
      AND e.type = p_type
      AND e.ts >= coalesce(p_from, '-infinity')
      AND e.ts <= least(coalesce(p_to, 'infinity'), p_before_ts)
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
