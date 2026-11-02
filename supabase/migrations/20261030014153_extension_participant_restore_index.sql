-- ABOUTME: Lets one participant page through their own collection events without scanning every participant.
-- ABOUTME: Indexes a 32-bit key of the participant id, since full ids are 133-character public keys.
-- In production the index is built with CREATE INDEX CONCURRENTLY outside the migration
-- transaction, during low traffic. This file records the same schema for local and preview databases.

-- The key is the first 32 bits of md5(participant_id), written inline rather than as a
-- function so the index build and the planner can evaluate it without a function call.
-- Collisions are expected and harmless: queries also compare the full participant_id,
-- so the key only narrows the index range.
CREATE INDEX IF NOT EXISTS idx_events_participant_key_type_ts
  ON public.collection_events (
    (('x' || substr(md5(participant_id), 1, 8))::bit(32)::integer),
    type,
    ts DESC
  );

-- One page of a participant's events of one type, newest first, strictly before the
-- (before_ts, before_id) cursor. Callers pass the last row of the previous page.
CREATE OR REPLACE FUNCTION public.participant_events_page(
  p_participant_id text,
  p_type text,
  p_before_ts timestamptz DEFAULT 'infinity',
  p_before_id text DEFAULT '',
  p_limit integer DEFAULT 1000
)
RETURNS SETOF public.collection_events
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT e.*
  FROM public.collection_events e
  WHERE ('x' || substr(md5(e.participant_id), 1, 8))::bit(32)::integer
      = ('x' || substr(md5(p_participant_id), 1, 8))::bit(32)::integer
    AND e.participant_id = p_participant_id
    AND e.type = p_type
    AND e.ts <= p_before_ts
    AND (e.ts, e.id) < (p_before_ts, p_before_id)
  ORDER BY e.ts DESC, e.id DESC
  LIMIT least(greatest(p_limit, 1), 1000)
$$;

-- Only the Worker (service role) may read a participant's history; it checks the
-- participant's signature first.
REVOKE ALL ON FUNCTION public.participant_events_page(text, text, timestamptz, text, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.participant_events_page(text, text, timestamptz, text, integer)
  TO service_role;
