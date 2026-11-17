-- ABOUTME: Registers searching scraps by meaning with the extension feature-access catalog.
-- ABOUTME: Starts it in beta, so only the beta cohort sees the opt-in model download on the scraps page.

INSERT INTO features (feature_id, name, description, stage)
VALUES (
  'SCRAP_MEANING_SEARCH',
  'Search scraps by meaning',
  'Download a picture-reading model to find scraps by what''s in them, like "eye" or "mask". It runs on this computer.',
  'beta'
)
ON CONFLICT(feature_id) DO UPDATE SET
  name = excluded.name,
  description = excluded.description;
