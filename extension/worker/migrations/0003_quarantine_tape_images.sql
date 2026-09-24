-- ABOUTME: Updates the quarantine-tape feature description for image taping.
-- ABOUTME: Preserves the internal stage established by the page-tape migration.

UPDATE features
SET description = 'Mark pages and images with shared caution tape.'
WHERE feature_id = 'QUARANTINE_TAPE';
