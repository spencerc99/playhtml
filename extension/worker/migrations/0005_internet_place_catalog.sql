-- ABOUTME: Stores durable human Internet place policies and imported page evidence.
-- ABOUTME: Keeps machine suggestions separate from the policies used by Internet Commute.

CREATE TABLE place_policies (
  scope TEXT NOT NULL CHECK (scope IN ('page', 'hostname', 'site')),
  place_key TEXT NOT NULL,
  verdict TEXT CHECK (verdict IN ('promoted', 'scenery-only', 'blocked')),
  reason TEXT,
  note TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (scope, place_key),
  CHECK (verdict IS NOT NULL OR note <> '')
);

CREATE INDEX place_policies_verdict
  ON place_policies(verdict, updated_at DESC);

CREATE TABLE place_evidence (
  page_key TEXT PRIMARY KEY,
  canonical_url TEXT NOT NULL UNIQUE,
  hostname TEXT NOT NULL,
  title TEXT NOT NULL,
  provenance TEXT NOT NULL,
  generated_at TEXT NOT NULL,
  evidence_json TEXT NOT NULL,
  imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX place_evidence_hostname
  ON place_evidence(hostname, generated_at DESC);
