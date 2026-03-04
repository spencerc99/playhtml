-- ABOUTME: SQL function returning event counts grouped by day for the calendar heatmap.
-- ABOUTME: Supports optional type and date range filters; uses idx_events_type_ts index.

CREATE OR REPLACE FUNCTION daily_event_counts(
  event_type TEXT DEFAULT NULL,
  from_date TIMESTAMPTZ DEFAULT NULL,
  to_date TIMESTAMPTZ DEFAULT NULL
)
RETURNS TABLE(day DATE, count BIGINT) AS $$
BEGIN
  RETURN QUERY
  SELECT date_trunc('day', ts)::date AS day, count(*) AS count
  FROM collection_events
  WHERE (event_type IS NULL OR type = event_type)
    AND (from_date IS NULL OR ts >= from_date)
    AND (to_date IS NULL OR ts <= to_date)
  GROUP BY 1
  ORDER BY 1;
END;
$$ LANGUAGE plpgsql STABLE;
