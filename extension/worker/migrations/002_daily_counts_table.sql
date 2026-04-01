-- Migration: Pre-computed daily event counts
-- Replaces the slow daily_event_counts RPC that scans the entire collection_events table.
-- The trigger keeps counts updated incrementally on each insert.

-- Step 1: Create the materialized counts table
CREATE TABLE IF NOT EXISTS daily_counts (
  day date NOT NULL,
  type text NOT NULL,
  count bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (day, type)
);

-- Step 2: Backfill from existing data
-- (This may take a minute on large tables — only runs once)
INSERT INTO daily_counts (day, type, count)
SELECT date_trunc('day', ts)::date, type, count(*)
FROM collection_events
GROUP BY 1, 2
ON CONFLICT (day, type) DO UPDATE SET count = EXCLUDED.count;

-- Step 3: Trigger to increment counts on each new event
CREATE OR REPLACE FUNCTION increment_daily_count()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO daily_counts (day, type, count)
  VALUES (date_trunc('day', NEW.ts)::date, NEW.type, 1)
  ON CONFLICT (day, type)
  DO UPDATE SET count = daily_counts.count + 1;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_daily_count
AFTER INSERT ON collection_events
FOR EACH ROW EXECUTE FUNCTION increment_daily_count();

-- Step 4: Also fix bogus hold durations from the mouseDownTime=0 bug
-- (duration stored as Unix timestamp instead of ms delta)
UPDATE collection_events
SET data = jsonb_set(data, '{duration}', '250')
WHERE type = 'cursor'
  AND data->>'event' = 'hold'
  AND (data->>'duration')::bigint > 3600000;
