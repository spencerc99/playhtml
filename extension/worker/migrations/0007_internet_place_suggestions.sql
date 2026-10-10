-- ABOUTME: Caches advisory Internet place suggestions produced by Workers AI.
-- ABOUTME: Keeps model output separate from human policies that affect the Commute.

CREATE TABLE place_suggestions (
  page_key TEXT NOT NULL,
  model TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  suggestion_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (page_key, model, prompt_version)
);
