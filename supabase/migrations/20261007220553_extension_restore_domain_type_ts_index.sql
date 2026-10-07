-- ABOUTME: Restores the collection-event index for looking up one site's events by type over time.
-- ABOUTME: Lets per-site cursor history (commute window replays) reach back days without timing out.
-- In production this index is built concurrently outside the migration transaction first, so
-- writes to collection_events are never blocked; this statement then finds it already present.

CREATE INDEX IF NOT EXISTS idx_events_domain_type_ts
  ON public.collection_events USING btree (domain, type, ts DESC);
