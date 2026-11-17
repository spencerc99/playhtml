-- ABOUTME: Lets one participant delete their own collection events from one site (and its subdomains).
-- ABOUTME: Deletes in bounded batches; the Worker checks the participant's signature and calls it until done.

-- Uses the participant key index from 20261030014153 to narrow to one participant's rows,
-- then matches the generated domain column. The anonymous daily_counts totals are left as is.
CREATE OR REPLACE FUNCTION public.delete_participant_site_events(
  p_participant_id text,
  p_host text,
  p_limit integer DEFAULT 5000
)
RETURNS integer
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_deleted integer;
BEGIN
  IF p_host IS NULL OR p_host !~ '^[a-z0-9-]+(\.[a-z0-9-]+)+$' THEN
    RAISE EXCEPTION 'invalid host';
  END IF;

  WITH doomed AS (
    SELECT e.ctid
    FROM public.collection_events e
    WHERE ('x' || substr(md5(e.participant_id), 1, 8))::bit(32)::integer
        = ('x' || substr(md5(p_participant_id), 1, 8))::bit(32)::integer
      AND e.participant_id = p_participant_id
      AND (lower(e.domain) = p_host OR lower(e.domain) LIKE '%.' || p_host)
    LIMIT least(greatest(p_limit, 1), 5000)
  )
  DELETE FROM public.collection_events e
  USING doomed
  WHERE e.ctid = doomed.ctid;

  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

-- Only the Worker (service role) may delete; it checks the participant's signature first.
REVOKE ALL ON FUNCTION public.delete_participant_site_events(text, text, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.delete_participant_site_events(text, text, integer)
  TO service_role;
