-- ABOUTME: Adds manifest rows for collection_events archive windows.
-- ABOUTME: Lets archive jobs verify exported chunks before any hot-row deletion.

CREATE TABLE IF NOT EXISTS public.collection_event_archives (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  status text NOT NULL CHECK (
    status IN ('planned', 'pending', 'written', 'verified', 'deleted', 'failed')
  ),
  event_type text NOT NULL,
  window_start timestamptz NOT NULL,
  window_end timestamptz NOT NULL,
  r2_key text NOT NULL UNIQUE,
  row_count bigint NOT NULL DEFAULT 0 CHECK (row_count >= 0),
  byte_count bigint NOT NULL DEFAULT 0 CHECK (byte_count >= 0),
  sha256 text,
  min_event_ts timestamptz,
  max_event_ts timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  verified_at timestamptz,
  deleted_at timestamptz,
  error text,
  CHECK (window_start < window_end)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_collection_event_archives_type_window
  ON public.collection_event_archives(event_type, window_start, window_end);

CREATE INDEX IF NOT EXISTS idx_collection_event_archives_status_created
  ON public.collection_event_archives(status, created_at);

COMMENT ON TABLE public.collection_event_archives
  IS 'Manifest rows for collection_events archive chunks stored outside Supabase';
COMMENT ON COLUMN public.collection_event_archives.status
  IS 'Archive lifecycle state for a planned or processed event chunk';
COMMENT ON COLUMN public.collection_event_archives.r2_key
  IS 'Object key for the archive chunk in Cloudflare R2';
