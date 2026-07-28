/**
 * Custom Playwright reporter that writes results + artifacts to the results store (FR-9, FR-13).
 * Activated via STORE_RESULTS=true environment variable.
 */

import type {
  Reporter,
  FullConfig,
  Suite,
  TestCase,
  TestResult as PWTestResult,
  FullResult,
} from "@playwright/test/reporter";
import { Pool } from "pg";
import { randomUUID } from "crypto";
import { uploadArtifact } from "../../services/shared/s3-client";
import path from "path";
import fs from "fs";

const DATABASE_URL =
  process.env.DATABASE_URL ||
  "postgresql://grafana_test:grafana_test@localhost:5432/grafana_ui_testing";

/**
 * Map a Playwright test *outcome* (computed across all attempts) to the status
 * we persist. Using the outcome — rather than a single attempt's status — is
 * what makes a retried-then-passed test record as `flaky` (once) instead of a
 * `failed` row plus a `flaky` row.
 */
export function outcomeToStatus(
  outcome: "skipped" | "expected" | "unexpected" | "flaky"
): "passed" | "failed" | "flaky" | "skipped" {
  switch (outcome) {
    case "expected":
      return "passed";
    case "unexpected":
      return "failed";
    case "flaky":
      return "flaky";
    case "skipped":
      return "skipped";
  }
}

/**
 * Collapse per-attempt reporter events into one entry per test — the FINAL
 * attempt (highest `retry`). Playwright fires `onTestEnd` once per attempt, so
 * without this a retried test would be written to the store multiple times
 * (inflating failure counts, clusters, and artifact uploads). First-seen order
 * is preserved for deterministic output.
 */
export function reduceToFinalAttempts<C, R extends { retry: number }>(
  entries: Array<{ testCase: C; result: R }>
): Array<{ testCase: C; result: R }> {
  const finalByCase = new Map<C, { testCase: C; result: R }>();
  for (const entry of entries) {
    const prev = finalByCase.get(entry.testCase);
    if (!prev || entry.result.retry >= prev.result.retry) {
      finalByCase.set(entry.testCase, entry);
    }
  }
  return Array.from(finalByCase.values());
}

/**
 * Build a stable, repo-relative test id of the form `<relative-file>::<title>`.
 * Playwright reports absolute file paths, and runs execute from a fresh clone in
 * a temp dir, so absolute paths are noisy and non-portable. Normalizing to a
 * path relative to the run root (cwd) makes ids match the on-disk test catalog
 * (e.g. `app_tests/vm-cluster/foo.spec.ts::my test`).
 */
export function makeTestId(
  file: string,
  title: string,
  rootDir: string = process.cwd()
): string {
  let rel = path.relative(rootDir, file);
  // If the file lives outside rootDir (path.relative starts with ".."), or the
  // relative computation failed, fall back to the original path.
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) {
    rel = file;
  }
  // Use forward slashes for cross-platform stability.
  rel = rel.split(path.sep).join("/");
  return `${rel}::${title}`;
}

class StoreReporter implements Reporter {
  private pool: Pool;
  private runId: string;
  private testResults: Array<{
    testCase: TestCase;
    result: PWTestResult;
  }> = [];

  constructor() {
    this.pool = new Pool({ connectionString: DATABASE_URL });
    this.runId = process.env.RUN_ID || randomUUID();
  }

  async onBegin(_config: FullConfig, _suite: Suite) {
    // Create the run record if RUN_ID was not provided (i.e., local run)
    if (!process.env.RUN_ID) {
      await this.pool.query(
        `INSERT INTO runs (id, trigger_source, commit_sha, grafana_version, selector, status, started_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
        [
          this.runId,
          process.env.TRIGGER_SOURCE || "manual",
          process.env.COMMIT_SHA || "local",
          process.env.GRAFANA_VERSION || "11.4.0",
          process.env.TEST_SELECTOR || "all",
          "running",
        ]
      );
    } else {
      // Update existing run to 'running'
      await this.pool.query(
        `UPDATE runs SET status = 'running', started_at = NOW() WHERE id = $1`,
        [this.runId]
      );
    }
  }

  onTestEnd(test: TestCase, result: PWTestResult) {
    this.testResults.push({ testCase: test, result });
  }

  async onEnd(result: FullResult) {
    const overallStatus = result.status === "passed" ? "passed" : "failed";

    // Write one result per test. Playwright reports every retry via onTestEnd,
    // so collapse to the final attempt and classify by the test's overall
    // outcome (see reduceToFinalAttempts / outcomeToStatus).
    for (const { testCase, result: testResult } of reduceToFinalAttempts(
      this.testResults
    )) {
      const testId = makeTestId(testCase.location.file, testCase.title);
      const status = outcomeToStatus(testCase.outcome());
      const resultId = randomUUID();

      // Normalize failure signature (only when the test ultimately failed).
      let failureSignature: string | null = null;
      if (status === "failed" && testResult.errors.length > 0) {
        failureSignature = testResult.errors
          .map((e) => e.message || "")
          .join("\n")
          .slice(0, 2000);
      }

      await this.pool.query(
        `INSERT INTO test_results (id, run_id, test_id, status, duration_ms, retry_count, failure_signature)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          resultId,
          this.runId,
          testId,
          status,
          testResult.duration,
          testResult.retry,
          failureSignature,
        ]
      );

      // Upload artifacts only when the test ultimately failed.
      if (status === "failed") {
        await this.uploadTestArtifacts(resultId, testId, testResult);
      }
    }

    // Update run status
    await this.pool.query(
      `UPDATE runs SET status = $1, finished_at = NOW() WHERE id = $2`,
      [overallStatus, this.runId]
    );

    await this.pool.end();
  }

  private async uploadTestArtifacts(
    resultId: string,
    testId: string,
    testResult: PWTestResult
  ) {
    for (const attachment of testResult.attachments) {
      if (!attachment.path || !fs.existsSync(attachment.path)) continue;

      const kind = this.mapArtifactKind(attachment.name);
      try {
        const objectUri = await uploadArtifact(
          attachment.path,
          this.runId,
          testId,
          kind
        );

        await this.pool.query(
          `INSERT INTO artifacts (id, test_result_id, kind, object_uri) VALUES ($1, $2, $3, $4)`,
          [randomUUID(), resultId, kind, objectUri]
        );
      } catch (err) {
        console.error(
          `Failed to upload artifact ${attachment.name} for ${testId}:`,
          err
        );
      }
    }
  }

  private mapArtifactKind(name: string): string {
    if (name.includes("trace")) return "trace";
    if (name.includes("video")) return "video";
    if (name.includes("screenshot")) return "screenshot";
    return "log";
  }
}

export default StoreReporter;
