-- ABOUTME: Registers collage share links with the extension feature-access catalog.
-- ABOUTME: Keeps sharing collages as public links internal while making it available to the internal cohort.

INSERT INTO features (feature_id, name, description, stage)
VALUES (
  'COLLAGE_SHARE_LINKS',
  'Collage share links',
  'Share a scrap collage as a view-only link anyone can open.',
  'internal'
)
ON CONFLICT(feature_id) DO UPDATE SET
  name = excluded.name,
  description = excluded.description;
