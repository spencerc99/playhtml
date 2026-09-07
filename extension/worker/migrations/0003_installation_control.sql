-- ABOUTME: Creates the singleton control row for unattended WWO installation screens.
-- ABOUTME: Tracks the generation that prompts each open installation tab to reload once.

CREATE TABLE installation_control (
  control_id INTEGER PRIMARY KEY CHECK (control_id = 1),
  reload_generation INTEGER NOT NULL DEFAULT 0 CHECK (reload_generation >= 0),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO installation_control (control_id, reload_generation) VALUES (1, 0);
