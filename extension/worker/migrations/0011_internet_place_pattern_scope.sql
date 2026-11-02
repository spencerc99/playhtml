-- ABOUTME: Adds the wildcard pattern scope to Internet place policies.
-- ABOUTME: Rebuilds the table because SQLite cannot change a CHECK constraint in place.

ALTER TABLE place_policies RENAME TO place_policies_before_pattern;

CREATE TABLE place_policies (
  scope TEXT NOT NULL CHECK (scope IN ('page', 'pattern', 'path', 'hostname', 'site')),
  place_key TEXT NOT NULL,
  placement TEXT CHECK (placement IN ('hidden', 'scenery', 'regular', 'featured', 'reserve')),
  reason TEXT,
  note TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (scope, place_key),
  CHECK (placement IS NOT NULL OR note <> '')
);

INSERT INTO place_policies (scope, place_key, placement, reason, note, updated_at)
SELECT scope, place_key, placement, reason, note, updated_at
FROM place_policies_before_pattern;

DROP TABLE place_policies_before_pattern;

CREATE INDEX place_policies_placement
  ON place_policies(placement, updated_at DESC);
