-- =============================================================================
-- 008_analyze.sql
-- Refresh planner statistics after a fresh install (safe to re-run).
-- Run after: 002_ingestion_file_state.sql
-- Full bundle: full_schema_empty_database.sql already ends with ANALYZE calls.
-- =============================================================================

ANALYZE chat_sessions;
ANALYZE chat_logs;
ANALYZE app_users;
ANALYZE ingestion_file_state;
