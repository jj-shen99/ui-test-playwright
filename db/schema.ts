/**
 * Drizzle ORM schema — mirrors the PostgreSQL data model from §9.
 */

import {
  pgTable,
  uuid,
  text,
  integer,
  real,
  boolean,
  timestamp,
  index,
  bigserial,
} from "drizzle-orm/pg-core";

// ── runs ──
export const runs = pgTable(
  "runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    triggerSource: text("trigger_source").notNull(), // 'pr' | 'nightly' | 'manual'
    commitSha: text("commit_sha").notNull(),
    grafanaVersion: text("grafana_version").notNull(),
    selector: text("selector").notNull(), // 'all' | 'smoke' | tag | file
    status: text("status").notNull().default("queued"), // 'queued'|'running'|'passed'|'failed'|'error'
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_runs_sha").on(table.commitSha),
    index("idx_runs_status").on(table.status),
  ]
);

// ── test_results ──
export const testResults = pgTable(
  "test_results",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    runId: uuid("run_id")
      .notNull()
      .references(() => runs.id),
    testId: text("test_id").notNull(), // stable identity: file::title
    status: text("status").notNull(), // 'passed'|'failed'|'skipped'|'flaky'
    durationMs: integer("duration_ms"),
    retryCount: integer("retry_count").default(0),
    failureSignature: text("failure_signature"), // normalized; null on pass
    clusterId: uuid("cluster_id"), // set by ML service
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_results_test").on(table.testId),
    index("idx_results_run").on(table.runId),
  ]
);

// ── artifacts ──
export const artifacts = pgTable("artifacts", {
  id: uuid("id").primaryKey().defaultRandom(),
  testResultId: uuid("test_result_id")
    .notNull()
    .references(() => testResults.id),
  kind: text("kind").notNull(), // 'trace'|'video'|'screenshot'|'log'
  objectUri: text("object_uri").notNull(),
});

// ── test_health (ML-maintained) ──
export const testHealth = pgTable("test_health", {
  testId: text("test_id").primaryKey(),
  flakinessScore: real("flakiness_score").notNull().default(0),
  quarantined: boolean("quarantined").notNull().default(false),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ── failure_clusters ──
export const failureClusters = pgTable("failure_clusters", {
  id: uuid("id").primaryKey().defaultRandom(),
  representative: text("representative").notNull(), // representative failure signature
  size: integer("size").notNull(),
  firstSeen: timestamp("first_seen", { withTimezone: true }).notNull(),
  lastSeen: timestamp("last_seen", { withTimezone: true }).notNull(),
});

// ── users ──
export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  role: text("role").notNull().default("user"), // 'admin' | 'user'
  passwordHash: text("password_hash").notNull(),
  active: boolean("active").notNull().default(true),
  resetToken: text("reset_token"),
  resetTokenExpiresAt: timestamp("reset_token_expires_at", { withTimezone: true }),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ── schedules ──
export const schedules = pgTable("schedules", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  cronExpression: text("cron_expression").notNull(), // e.g. '0 2 * * *' for 2am daily
  selector: text("selector").notNull().default("all"), // 'all' | 'smoke' | tag | file
  testIds: text("test_ids"), // JSON array of individual test IDs, or null for preset
  grafanaVersion: text("grafana_version").notNull().default("11.4.0"),
  targetUrl: text("target_url"), // remote application URL, or null for local env
  authType: text("auth_type").notNull().default("none"), // 'none' | 'basic' | 'token'
  authUsername: text("auth_username"),
  authPassword: text("auth_password"), // encrypted at rest (#2); legacy rows may be plaintext
  authToken: text("auth_token"), // encrypted at rest (#2); legacy rows may be plaintext
  authProfileId: uuid("auth_profile_id"), // optional reusable named credential / SSO session (#1/#2)
  enabled: boolean("enabled").notNull().default(true),
  createdBy: uuid("created_by").references(() => users.id),
  lastRunAt: timestamp("last_run_at", { withTimezone: true }),
  nextRunAt: timestamp("next_run_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ── auth_profiles (reusable named credentials / captured SSO sessions) ──
// Secrets (password/token/storageState) are stored ENCRYPTED at rest (#2, #1).
export const authProfiles = pgTable("auth_profiles", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull().unique(),
  // 'basic' | 'token' | 'storage_state'
  kind: text("kind").notNull(),
  targetUrl: text("target_url"), // optional origin this profile is scoped to
  username: text("username"), // basic-auth username (not secret)
  secretEnc: text("secret_enc"), // encrypted password or token
  storageStateEnc: text("storage_state_enc"), // encrypted Playwright storageState JSON (SSO)
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ── audit_log (who did what, #19) ──
export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    actorId: uuid("actor_id"), // user id from the identity header, may be null
    actorEmail: text("actor_email"), // denormalized for display even if user deleted
    action: text("action").notNull(), // e.g. 'run.delete', 'run.trigger', 'user.create'
    targetType: text("target_type"), // 'run' | 'test' | 'schedule' | 'user' | 'auth_profile'
    targetId: text("target_id"),
    detail: text("detail"), // short human-readable context
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("idx_audit_created").on(table.createdAt)]
);

// ── test_type_overrides (user-assigned test classification) ──
export const testTypeOverrides = pgTable("test_type_overrides", {
  testId: text("test_id").primaryKey(),
  testType: text("test_type").notNull(), // 'smoke' | 'sanity' | 'regression' | 'e2e'
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ── run_logs (streamed console output for a run) ──
export const runLogs = pgTable(
  "run_logs",
  {
    seq: bigserial("seq", { mode: "number" }).primaryKey(),
    runId: uuid("run_id").notNull(),
    stream: text("stream").notNull().default("system"), // 'system' | 'stdout' | 'stderr'
    message: text("message").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("idx_run_logs_run").on(table.runId, table.seq)]
);

// ── Type exports for use across services ──
export type Run = typeof runs.$inferSelect;
export type NewRun = typeof runs.$inferInsert;
export type TestResult = typeof testResults.$inferSelect;
export type NewTestResult = typeof testResults.$inferInsert;
export type Artifact = typeof artifacts.$inferSelect;
export type NewArtifact = typeof artifacts.$inferInsert;
export type TestHealth = typeof testHealth.$inferSelect;
export type FailureCluster = typeof failureClusters.$inferSelect;
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Schedule = typeof schedules.$inferSelect;
export type NewSchedule = typeof schedules.$inferInsert;
export type TestTypeOverride = typeof testTypeOverrides.$inferSelect;
export type NewTestTypeOverride = typeof testTypeOverrides.$inferInsert;
export type RunLog = typeof runLogs.$inferSelect;
export type NewRunLog = typeof runLogs.$inferInsert;
export type AuthProfile = typeof authProfiles.$inferSelect;
export type NewAuthProfile = typeof authProfiles.$inferInsert;
export type AuditLogEntry = typeof auditLog.$inferSelect;
export type NewAuditLogEntry = typeof auditLog.$inferInsert;
