-- ABOUTME: Lets the Worker read one site's events of one type, newest first, without scanning the table.
-- ABOUTME: Backs /events/recent?domain=... (trails overlay, keypresses and other site-filtered views).
-- In production the index was built with CREATE INDEX CONCURRENTLY outside the migration
-- transaction. This file records the same schema for local and preview databases.

-- CREATE INDEX IF NOT EXISTS takes a SHARE lock on the table before it looks for the
-- index, and DROP INDEX takes an ACCESS EXCLUSIVE lock. On a busy table either can queue
-- behind a long write and block ingestion behind itself. So the catalog is checked first
-- and no lock is requested when there is nothing to do, and any lock that is needed gives
-- up after a few seconds instead of waiting.
SET LOCAL lock_timeout = '5s';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_index i
    JOIN pg_class c ON c.oid = i.indexrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'idx_events_domain_type_ts'
      AND i.indisvalid
  ) THEN
    CREATE INDEX IF NOT EXISTS idx_events_domain_type_ts
      ON public.collection_events USING btree (domain, type, ts DESC);
  END IF;

  -- A zero-byte invalid index left behind by an interrupted concurrent build.
  IF EXISTS (
    SELECT 1
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'idx_events_url_ts' AND c.relkind = 'i'
  ) THEN
    DROP INDEX public.idx_events_url_ts;
  END IF;
END
$$;
