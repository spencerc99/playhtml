-- ABOUTME: Registers quarantine tape with the extension feature-access catalog.
-- ABOUTME: Keeps page taping internal while making it available to the internal cohort.

INSERT INTO features (feature_id, name, description, stage)
VALUES (
  'QUARANTINE_TAPE',
  'Quarantine tape',
  'Mark pages with shared caution tape.',
  'internal'
)
ON CONFLICT(feature_id) DO UPDATE SET
  name = excluded.name,
  description = excluded.description;
