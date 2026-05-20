-- =============================================================================
-- 004_chat_sessions_title.sql
-- Conversation title for sidebar (idempotent).
-- Run after: 001_app_users.sql
-- Next:      005_chat_sessions_metadata.sql
-- Mirror:    supabase/migrations/004_add_conversation_title.sql (keep in sync)
-- =============================================================================

ALTER TABLE chat_sessions
ADD COLUMN IF NOT EXISTS title TEXT;

CREATE INDEX IF NOT EXISTS idx_chat_sessions_title
ON chat_sessions(title);

COMMENT ON COLUMN chat_sessions.title IS 'AI-generated conversation title (max 40 chars)';
