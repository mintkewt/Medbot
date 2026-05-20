-- =============================================================================
-- 005_chat_sessions_metadata.sql
-- Sidebar metadata: pin, updated_at, trigger, indexes (idempotent).
-- Run after: 004_chat_sessions_title.sql
-- Next:      002_ingestion_file_state.sql
-- Mirror:    supabase/migrations/005_add_chat_session_metadata.sql (keep in sync)
-- =============================================================================

ALTER TABLE chat_sessions
ADD COLUMN IF NOT EXISTS is_pinned BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE chat_sessions
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE OR REPLACE FUNCTION set_chat_sessions_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_chat_sessions_updated_at ON chat_sessions;
CREATE TRIGGER trg_chat_sessions_updated_at
BEFORE UPDATE ON chat_sessions
FOR EACH ROW
EXECUTE FUNCTION set_chat_sessions_updated_at();

UPDATE chat_sessions
SET updated_at = COALESCE(updated_at, created_at, NOW())
WHERE updated_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_chat_sessions_user_pin_updated
ON chat_sessions(user_id, is_pinned DESC, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_chat_logs_session_created_desc
ON chat_logs(session_id, created_at DESC);
