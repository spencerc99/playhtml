-- ABOUTME: Lets the Worker read one site's events of one type, newest first, without scanning the table.
-- ABOUTME: Backs /events/recent?domain=... (trails overlay, keypresses and other site-filtered views).
-- In production the index was built with CREATE INDEX CONCURRENTLY outside the migration
-- transaction. This file records the same schema for local and preview databases, and is a
-- no-op where the index already exists.

CREATE INDEX IF NOT EXISTS idx_events_domain_type_ts
  ON public.collection_events USING btree (domain, type, ts DESC);

-- A zero-byte invalid index left behind by an interrupted concurrent build.
DROP INDEX IF EXISTS public.idx_events_url_ts;
