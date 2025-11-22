-- Create room_redirects table for handling room ID migrations
-- This allows old room IDs to redirect to new normalized room IDs

CREATE TABLE IF NOT EXISTS room_redirects (
  old_name TEXT PRIMARY KEY,
  new_name TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  migrated BOOLEAN DEFAULT false,

  -- Foreign key to ensure new_name exists in documents table
  CONSTRAINT fk_new_name FOREIGN KEY (new_name)
    REFERENCES documents(name)
    ON DELETE CASCADE
);

-- Index on new_name for faster lookups
CREATE INDEX IF NOT EXISTS idx_room_redirects_new_name
  ON room_redirects(new_name);

-- Index on created_at for cleanup queries
CREATE INDEX IF NOT EXISTS idx_room_redirects_created_at
  ON room_redirects(created_at);

COMMENT ON TABLE room_redirects IS 'Maps old room IDs to new normalized room IDs for backward compatibility during migrations';
COMMENT ON COLUMN room_redirects.old_name IS 'The old/deprecated room ID that should redirect';
COMMENT ON COLUMN room_redirects.new_name IS 'The new/canonical room ID to redirect to';
COMMENT ON COLUMN room_redirects.migrated IS 'Whether this redirect was created during a migration (vs runtime)';
