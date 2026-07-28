/**
 * Seed the results store with deterministic sample data (#25).
 *
 * Populates `runs`, `test_results`, and `test_health` so the UI (/results,
 * catalog, insights) has data to render locally without executing a full
 * Playwright run. Idempotent: fixture rows use stable ids and are cleared and
 * re-inserted on each invocation.
 *
 * Usage:
 *   npm run seed:results            # default 8 runs
 *   npm run seed:results -- --runs 20
 *   npm run seed:results -- --clear # remove fixture rows and exit
 */

import "dotenv/config";
import { Pool } from "pg";
import {
  buildResultsFixture,
  fixtureId,
  FIXTURE_TESTS,
} from "../tests/fixtures/results-fixture";

const DATABASE_URL =
  process.env.DATABASE_URL ||
  "postgresql://grafana_test:grafana_test@localhost:5432/grafana_ui_testing";

/** All fixture run ids share the "11111111" prefix, so we can target them for cleanup. */
const FIXTURE_RUN_PREFIX = fixtureId("11111111", 0).slice(0, 8);

async function clearFixture(pool: Pool): Promise<void> {
  // Delete children first (no ON DELETE CASCADE). Target only fixture rows.
  // `run_id`/`id` are uuid columns and Postgres has no LIKE operator for uuid,
  // so cast to text for the fixture-prefix match.
  await pool.query(
    `DELETE FROM artifacts WHERE test_result_id IN (
       SELECT id FROM test_results WHERE run_id::text LIKE $1
     )`,
    [`${FIXTURE_RUN_PREFIX}-%`]
  );
  await pool.query(`DELETE FROM test_results WHERE run_id::text LIKE $1`, [
    `${FIXTURE_RUN_PREFIX}-%`,
  ]);
  await pool.query(`DELETE FROM run_logs WHERE run_id::text LIKE $1`, [
    `${FIXTURE_RUN_PREFIX}-%`,
  ]);
  await pool.query(`DELETE FROM runs WHERE id::text LIKE $1`, [`${FIXTURE_RUN_PREFIX}-%`]);

  // Also remove the fixture's health rows, otherwise a fixture-quarantined test
  // stays quarantined after --clear and would skip in real runs.
  await pool.query(`DELETE FROM test_health WHERE test_id = ANY($1)`, [
    FIXTURE_TESTS.map((t) => t.testId),
  ]);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const clearOnly = args.includes("--clear");
  const runsIdx = args.indexOf("--runs");
  const runCount = runsIdx >= 0 ? Number(args[runsIdx + 1]) : undefined;

  const pool = new Pool({ connectionString: DATABASE_URL });

  try {
    console.log("Clearing existing fixture rows...");
    await clearFixture(pool);

    if (clearOnly) {
      console.log("Fixture rows cleared. Done.");
      return;
    }

    const fixture = buildResultsFixture(new Date(), { runCount });
    console.log(
      `Seeding ${fixture.runs.length} runs, ${fixture.testResults.length} results, ${fixture.testHealth.length} health rows...`
    );

    for (const r of fixture.runs) {
      await pool.query(
        `INSERT INTO runs (id, trigger_source, commit_sha, grafana_version, selector, status, started_at, finished_at, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [
          r.id,
          r.triggerSource,
          r.commitSha,
          r.grafanaVersion,
          r.selector,
          r.status,
          r.startedAt,
          r.finishedAt,
          r.createdAt,
        ]
      );
    }

    for (const t of fixture.testResults) {
      await pool.query(
        `INSERT INTO test_results (id, run_id, test_id, status, duration_ms, retry_count, failure_signature, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          t.id,
          t.runId,
          t.testId,
          t.status,
          t.durationMs,
          t.retryCount,
          t.failureSignature,
          t.createdAt,
        ]
      );
    }

    for (const h of fixture.testHealth) {
      await pool.query(
        `INSERT INTO test_health (test_id, flakiness_score, quarantined, updated_at)
         VALUES ($1,$2,$3,$4)
         ON CONFLICT (test_id) DO UPDATE SET
           flakiness_score = EXCLUDED.flakiness_score,
           quarantined = EXCLUDED.quarantined,
           updated_at = EXCLUDED.updated_at`,
        [h.testId, h.flakinessScore, h.quarantined, h.updatedAt]
      );
    }

    console.log("Results fixture seeded. Open the UI /results to explore.");
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error("Seeding results failed:", err);
  process.exit(1);
});
