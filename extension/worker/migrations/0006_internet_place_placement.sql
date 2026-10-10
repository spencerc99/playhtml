-- ABOUTME: Rebuilds Internet place policy storage with five explicit placement levels.
-- ABOUTME: Maps durable human decisions to equivalent placement semantics.

ALTER TABLE place_policies RENAME TO place_policies_verdicts;

CREATE TABLE place_policies (
  scope TEXT NOT NULL CHECK (scope IN ('page', 'hostname', 'site')),
  place_key TEXT NOT NULL,
  placement TEXT CHECK (placement IN ('hidden', 'scenery', 'regular', 'featured', 'reserve')),
  reason TEXT,
  note TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (scope, place_key),
  CHECK (placement IS NOT NULL OR note <> '')
);

INSERT INTO place_policies (scope, place_key, placement, reason, note, updated_at)
SELECT
  scope,
  place_key,
  CASE verdict
    WHEN 'blocked' THEN 'hidden'
    WHEN 'scenery-only' THEN 'scenery'
    WHEN 'promoted' THEN 'featured'
  END,
  reason,
  note,
  updated_at
FROM place_policies_verdicts;

DROP TABLE place_policies_verdicts;

CREATE INDEX place_policies_placement
  ON place_policies(placement, updated_at DESC);
