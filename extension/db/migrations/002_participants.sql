-- Participant identity and preferences
-- Keyed by ECDSA P-256 public key hex (prefixed 'pk_')

CREATE TABLE IF NOT EXISTS participants (
  pid TEXT PRIMARY KEY,
  cursor_color TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_participants_updated
  ON participants (updated_at DESC);

COMMENT ON TABLE participants IS 'Participant identity and display preferences';
COMMENT ON COLUMN participants.pid IS 'ECDSA P-256 public key hex, prefixed pk_';
COMMENT ON COLUMN participants.cursor_color IS 'Hex color string chosen by participant';
