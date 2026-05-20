-- =============================================================================
-- 001_app_users.sql
-- JWT login accounts (bcrypt). Idempotent.
-- Mirror: supabase/migrations/009_app_users.sql
-- Bundled in: supabase/schema/full_schema_empty_database.sql
-- =============================================================================

CREATE TABLE IF NOT EXISTS app_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  password_hash text NOT NULL,
  created_at timestamptz DEFAULT now(),
  CONSTRAINT app_users_email_unique UNIQUE (email)
);

CREATE INDEX IF NOT EXISTS idx_app_users_email_lower ON app_users (lower(email));

COMMENT ON TABLE app_users IS 'Local app accounts; create rows via scripts/seed-user.js or INSERT with bcrypt hash.';

ALTER TABLE app_users ENABLE ROW LEVEL SECURITY;
