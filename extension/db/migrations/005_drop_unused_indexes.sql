-- Drop indexes on collection_events that are never used by any query.
-- Verified via pg_stat_user_indexes (idx_scan = 0 since database start) on 2026-05-25.
-- Reclaims ~4 GB of disk and removes write amplification on every event insert:
--   * idx_events_participant_ts (2.9 GB)
--   * idx_events_domain_type_ts (754 MB)
--   * idx_events_type_ts (441 MB)
--
-- The remaining indexes on collection_events:
--   * collection_events_pkey   — used for upsert conflict detection
--   * idx_events_ts (ts DESC)  — used by /events/recent
--
-- Use CONCURRENTLY to avoid taking ACCESS EXCLUSIVE on the table during ingest.

DROP INDEX CONCURRENTLY IF EXISTS public.idx_events_participant_ts;
DROP INDEX CONCURRENTLY IF EXISTS public.idx_events_domain_type_ts;
DROP INDEX CONCURRENTLY IF EXISTS public.idx_events_type_ts;
