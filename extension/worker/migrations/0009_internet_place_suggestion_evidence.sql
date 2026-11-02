-- ABOUTME: Associates advisory suggestions with the evidence used to generate them.
-- ABOUTME: Leaves older cache rows unmatched until they are regenerated.

ALTER TABLE place_suggestions ADD COLUMN evidence_hash TEXT;
