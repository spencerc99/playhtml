-- ABOUTME: Registers scrap collages with the extension feature-access catalog.
-- ABOUTME: Keeps collage building internal while making it available to the internal cohort.

INSERT INTO features (feature_id, name, description, stage)
VALUES (
  'SCRAP_COLLAGES',
  'Scrap collages',
  'Arrange your collected scraps into saved collages.',
  'internal'
)
ON CONFLICT(feature_id) DO UPDATE SET
  name = excluded.name,
  description = excluded.description;
