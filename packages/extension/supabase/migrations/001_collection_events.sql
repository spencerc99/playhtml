-- Create collection_events table for storing browsing behavior events
-- This table stores events collected by the browser extension

CREATE TABLE IF NOT EXISTS collection_events (
  id TEXT PRIMARY KEY,           -- ULID (sortable, unique)
  type TEXT NOT NULL,            -- 'cursor', 'navigation', 'viewport'
  ts TIMESTAMPTZ NOT NULL,       -- Event timestamp
  participant_id TEXT NOT NULL,  -- Anonymous participant ID
  session_id TEXT NOT NULL,      -- Browser session ID
  url TEXT,                      -- Current page URL
  viewport_width INT,            -- Viewport width
  viewport_height INT,           -- Viewport height
  timezone TEXT,                 -- Timezone (e.g., "America/New_York")
  data JSONB NOT NULL            -- Type-specific payload
);

-- Index for querying by participant/time
CREATE INDEX IF NOT EXISTS idx_events_participant_ts 
  ON collection_events(participant_id, ts);

-- Index for querying by type/time (for artwork rendering)
CREATE INDEX IF NOT EXISTS idx_events_type_ts 
  ON collection_events(type, ts);

-- Index for recent events (live artwork)
CREATE INDEX IF NOT EXISTS idx_events_ts 
  ON collection_events(ts DESC);

-- Index for URL queries (optional, for analytics)
CREATE INDEX IF NOT EXISTS idx_events_url 
  ON collection_events(url);

-- Comments for documentation
COMMENT ON TABLE collection_events IS 'Stores browsing behavior events collected by the extension';
COMMENT ON COLUMN collection_events.id IS 'ULID - Universally Unique Lexicographically Sortable Identifier';
COMMENT ON COLUMN collection_events.participant_id IS 'Anonymous participant ID (persistent across sessions)';
COMMENT ON COLUMN collection_events.session_id IS 'Browser session ID (unique per session)';
COMMENT ON COLUMN collection_events.data IS 'Type-specific event payload (JSON)';
