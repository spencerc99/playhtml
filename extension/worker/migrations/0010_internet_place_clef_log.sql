-- ABOUTME: Keeps every answer Clef gives, with what it was shown, for the curation desk's log.
-- ABOUTME: place_suggestions holds only the latest answer per page; this table never overwrites.

CREATE TABLE place_clef_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  page_key TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('page', 'name')),
  prompt_version TEXT NOT NULL,
  input_json TEXT NOT NULL,
  suggestion_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX place_clef_log_created ON place_clef_log (created_at DESC, id DESC);
CREATE INDEX place_clef_log_page ON place_clef_log (page_key, created_at DESC);
