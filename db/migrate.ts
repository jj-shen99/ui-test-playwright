/**
 * Database migration script — creates all tables from the schema (§9).
 * Uses raw SQL for the initial migration to match the spec exactly.
 */

import "dotenv/config";
import { Pool } from "pg";

const DATABASE_URL =
  process.env.DATABASE_URL ||
  "postgresql://grafana_test:grafana_test@localhost:5432/grafana_ui_testing";

const MIGRATION_SQL = `
-- Extension for UUID generation
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- a single execution of a suite
CREATE TABLE IF NOT EXISTS runs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trigger_source  TEXT NOT NULL,
  commit_sha      TEXT NOT NULL,
  grafana_version TEXT NOT NULL,
  selector        TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'queued',
  started_at      TIMESTAMPTZ,
  finished_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- one row per test per run
CREATE TABLE IF NOT EXISTS test_results (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id           UUID NOT NULL REFERENCES runs(id),
  test_id          TEXT NOT NULL,
  status           TEXT NOT NULL,
  duration_ms      INTEGER,
  retry_count      INTEGER DEFAULT 0,
  failure_signature TEXT,
  cluster_id       UUID,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- artifacts (trace/video/screenshot/logs) for a test result
CREATE TABLE IF NOT EXISTS artifacts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  test_result_id  UUID NOT NULL REFERENCES test_results(id),
  kind            TEXT NOT NULL,
  object_uri      TEXT NOT NULL
);

-- ML-maintained per-test flakiness state
CREATE TABLE IF NOT EXISTS test_health (
  test_id         TEXT PRIMARY KEY,
  flakiness_score REAL NOT NULL DEFAULT 0,
  quarantined     BOOLEAN NOT NULL DEFAULT false,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- failure clusters
CREATE TABLE IF NOT EXISTS failure_clusters (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  representative  TEXT NOT NULL,
  size            INTEGER NOT NULL,
  first_seen      TIMESTAMPTZ NOT NULL,
  last_seen       TIMESTAMPTZ NOT NULL
);

-- users
CREATE TABLE IF NOT EXISTS users (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email                   TEXT NOT NULL UNIQUE,
  name                    TEXT NOT NULL,
  role                    TEXT NOT NULL DEFAULT 'user',
  password_hash           TEXT NOT NULL,
  active                  BOOLEAN NOT NULL DEFAULT true,
  reset_token             TEXT,
  reset_token_expires_at  TIMESTAMPTZ,
  last_login_at           TIMESTAMPTZ,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Migrate existing role values
UPDATE users SET role = 'user' WHERE role IN ('viewer', 'editor');

-- Add reset columns if upgrading
ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_token TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_token_expires_at TIMESTAMPTZ;

-- schedules
CREATE TABLE IF NOT EXISTS schedules (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name             TEXT NOT NULL,
  cron_expression  TEXT NOT NULL,
  selector         TEXT NOT NULL DEFAULT 'all',
  test_ids         TEXT,
  grafana_version  TEXT NOT NULL DEFAULT '11.4.0',
  target_url       TEXT,
  auth_type        TEXT NOT NULL DEFAULT 'none',
  auth_username    TEXT,
  auth_password    TEXT,
  auth_token       TEXT,
  enabled          BOOLEAN NOT NULL DEFAULT true,
  created_by       UUID REFERENCES users(id),
  last_run_at      TIMESTAMPTZ,
  next_run_at      TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Add schedule target/auth columns if upgrading
ALTER TABLE schedules ADD COLUMN IF NOT EXISTS test_ids      TEXT;
ALTER TABLE schedules ADD COLUMN IF NOT EXISTS target_url    TEXT;
ALTER TABLE schedules ADD COLUMN IF NOT EXISTS auth_type     TEXT NOT NULL DEFAULT 'none';
ALTER TABLE schedules ADD COLUMN IF NOT EXISTS auth_username TEXT;
ALTER TABLE schedules ADD COLUMN IF NOT EXISTS auth_password TEXT;
ALTER TABLE schedules ADD COLUMN IF NOT EXISTS auth_token    TEXT;

-- app configuration (key-value store for editable settings)
CREATE TABLE IF NOT EXISTS app_config (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- reusable named credentials / captured SSO sessions (#1, #2)
-- secret_enc / storage_state_enc hold AES-256-GCM ciphertext (see services/shared/crypto.ts)
CREATE TABLE IF NOT EXISTS auth_profiles (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name              TEXT NOT NULL UNIQUE,
  kind              TEXT NOT NULL,             -- 'basic' | 'token' | 'storage_state'
  target_url        TEXT,
  username          TEXT,
  secret_enc        TEXT,
  storage_state_enc TEXT,
  created_by        UUID REFERENCES users(id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- optional reference from a schedule to a reusable auth profile
ALTER TABLE schedules ADD COLUMN IF NOT EXISTS auth_profile_id UUID;

-- audit log: who did what (#19)
CREATE TABLE IF NOT EXISTS audit_log (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id     UUID,
  actor_email  TEXT,
  action       TEXT NOT NULL,
  target_type  TEXT,
  target_id    TEXT,
  detail       TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at DESC);

-- user-assigned test type classification (overrides tag/path-derived type)
CREATE TABLE IF NOT EXISTS test_type_overrides (
  test_id    TEXT PRIMARY KEY,
  test_type  TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- streamed console output for a run (for live log viewing)
CREATE TABLE IF NOT EXISTS run_logs (
  seq        BIGSERIAL PRIMARY KEY,
  run_id     UUID NOT NULL,
  stream     TEXT NOT NULL DEFAULT 'system',
  message    TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_run_logs_run ON run_logs(run_id, seq);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_results_test ON test_results(test_id);
CREATE INDEX IF NOT EXISTS idx_results_run  ON test_results(run_id);
CREATE INDEX IF NOT EXISTS idx_runs_sha     ON runs(commit_sha);
CREATE INDEX IF NOT EXISTS idx_runs_status  ON runs(status);
CREATE INDEX IF NOT EXISTS idx_users_email  ON users(email);
CREATE INDEX IF NOT EXISTS idx_schedules_enabled ON schedules(enabled);
`;

async function migrate() {
  const pool = new Pool({ connectionString: DATABASE_URL });

  try {
    console.log("Running database migration...");
    await pool.query(MIGRATION_SQL);
    console.log("Migration complete.");
  } catch (err) {
    console.error("Migration failed:", err);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

migrate();
