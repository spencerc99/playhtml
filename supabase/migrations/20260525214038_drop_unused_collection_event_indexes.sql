-- ABOUTME: Records the removal of unused collection-event indexes from the shared database.
-- ABOUTME: Keeps local and preview migration history aligned with the production project.
-- The production indexes were dropped concurrently outside the migration transaction.

DROP INDEX IF EXISTS public.idx_events_participant_ts;
DROP INDEX IF EXISTS public.idx_events_domain_type_ts;
DROP INDEX IF EXISTS public.idx_events_type_ts;
