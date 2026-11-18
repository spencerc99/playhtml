-- ABOUTME: Lets the Worker read one page's events of one type, newest first, through md5(url), type and ts.
-- ABOUTME: Backs page_events_page (/events/recent?urlHash=...); a type that is rare on a busy page no longer scans its history.
-- In production the index was built with CREATE INDEX CONCURRENTLY outside the migration
-- transaction. This file records the same schema for local and preview databases.

-- CREATE INDEX IF NOT EXISTS takes a SHARE lock on the table before it looks for the
-- index. On a busy table that lock can queue behind a long write and block ingestion
-- behind itself. So the catalog is checked first and no lock is requested when the
-- index is already there, and a lock that is needed gives up after a few seconds
-- instead of waiting for it.
SET LOCAL lock_timeout = '5s';

DO $$
BEGIN
  -- An interrupted concurrent build leaves the name behind as an INVALID index.
  -- CREATE INDEX IF NOT EXISTS would skip it and report success with no usable
  -- index, so stop instead: it has to be dropped and rebuilt concurrently by hand.
  IF EXISTS (
    SELECT 1
    FROM pg_index i
    JOIN pg_class c ON c.oid = i.indexrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'idx_events_urlhash_type_ts'
      AND NOT i.indisvalid
  ) THEN
    RAISE EXCEPTION 'idx_events_urlhash_type_ts exists but is INVALID: drop it and rebuild it with CREATE INDEX CONCURRENTLY, then rerun this migration';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_index i
    JOIN pg_class c ON c.oid = i.indexrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'idx_events_urlhash_type_ts'
      AND i.indisvalid
  ) THEN
    -- A plain CREATE INDEX holds its lock for the whole build and blocks every
    -- insert meanwhile. That is fine on a small local or preview table and not
    -- on a large one, where the index has to be built concurrently by hand first.
    IF (SELECT reltuples FROM pg_class WHERE oid = 'public.collection_events'::regclass) > 1000000 THEN
      RAISE EXCEPTION 'idx_events_urlhash_type_ts is missing on a large table: build it with CREATE INDEX CONCURRENTLY, then rerun this migration';
    END IF;
    CREATE INDEX IF NOT EXISTS idx_events_urlhash_type_ts
      ON public.collection_events USING btree (md5(url), type, ts DESC);
  END IF;
END
$$;
