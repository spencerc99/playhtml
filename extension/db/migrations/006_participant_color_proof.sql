-- ABOUTME: Stores replay-safe versions for signed participant color updates.
-- ABOUTME: Rejects older participant color updates after newer ones are saved.

ALTER TABLE participants
  ADD COLUMN IF NOT EXISTS color_version BIGINT NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION upsert_participant_color(
  p_pid TEXT,
  p_cursor_color TEXT,
  p_color_version BIGINT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO participants (pid, cursor_color, color_version)
  VALUES (p_pid, p_cursor_color, p_color_version)
  ON CONFLICT (pid) DO UPDATE
    SET cursor_color = EXCLUDED.cursor_color,
        color_version = EXCLUDED.color_version,
        updated_at = now()
    WHERE EXCLUDED.color_version > participants.color_version;

  RETURN FOUND;
END;
$$;
