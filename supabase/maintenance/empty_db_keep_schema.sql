-- =============================================================================
-- Empty app data (keep relational schema)
--
-- Wipes chat, optional ingest checkpoints, and JWT users. RAG vectors live in
-- Zilliz — clear the collection there separately if needed.
-- =============================================================================

BEGIN;

TRUNCATE TABLE ingestion_file_state RESTART IDENTITY;

DO $$
BEGIN
  IF to_regclass('public.app_users') IS NOT NULL THEN
    TRUNCATE TABLE app_users;
  END IF;
END $$;

TRUNCATE TABLE chat_sessions RESTART IDENTITY CASCADE;

COMMIT;

ANALYZE chat_sessions;
ANALYZE chat_logs;
DO $$
BEGIN
  IF to_regclass('public.app_users') IS NOT NULL THEN
    EXECUTE 'ANALYZE app_users';
  END IF;
END $$;
ANALYZE ingestion_file_state;
