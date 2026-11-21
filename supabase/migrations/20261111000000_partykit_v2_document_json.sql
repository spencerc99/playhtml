-- ABOUTME: Adds versioned JSON persistence for PartyKit v2 room snapshots.
-- ABOUTME: Preserves the v1 document column so both room servers can coexist.

ALTER TABLE public.documents
  ADD COLUMN document_json jsonb NULL,
  ADD COLUMN protocol_version int NOT NULL DEFAULT 1;
