/**
 * Execution Orchestrator (§8.2)
 * BullMQ worker that processes test run jobs.
 * Run lifecycle: receive → checkout → spin up env → seed → resolve quarantine → run Playwright → collect → store → teardown
 */

import "dotenv/config";
import { Worker, type Job } from "bullmq";
import IORedis from "ioredis";
import { execSync, spawn } from "child_process";
import path from "path";
import { Pool } from "pg";
import fs from "fs";
import {
  type RunTarget,
  buildTargetEnv,
  buildRunEnvOverrides,
  buildShardPlan,
  mergeShardStatuses,
  resolveShardCount,
  resolveAuthStatePath,
  type RunEnvOverrides,
} from "./run-command";
import { redactSecrets } from "../shared/redact";

const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";
const DATABASE_URL =
  process.env.DATABASE_URL ||
  "postgresql://grafana_test:grafana_test@localhost:5432/grafana_ui_testing";
const PROJECT_ROOT = process.env.PROJECT_ROOT || path.resolve(__dirname, "../..");
const TEST_REPO_URL =
  process.env.TEST_REPO_URL ||
  "https://code.devsnc.com/jianjun-shen/grafana-ui-testing";
const TEST_REPO_BRANCH = process.env.TEST_REPO_BRANCH || "main";
// Playwright config (relative to the cloned repo) that discovers tests under
// app_tests/. Override with TEST_PLAYWRIGHT_CONFIG if needed.
const TEST_CONFIG =
  process.env.TEST_PLAYWRIGHT_CONFIG || "app_tests/playwright.config.ts";

interface RunJobData {
  runId: string;
  selector: string;
  testIds?: string[];
  grafanaVersion: string;
  commitSha: string;
  triggerSource: string;
  target?: RunTarget;
  envOverrides?: RunEnvOverrides;
  /** Split the run across N Playwright shards executed in parallel (#13). */
  shards?: number;
}

const pool = new Pool({ connectionString: DATABASE_URL });

async function updateRunStatus(
  runId: string,
  status: string,
  extra: Record<string, unknown> = {}
) {
  const sets = [`status = $2`];
  const values: unknown[] = [runId, status];
  let paramIdx = 3;

  if (extra.startedAt) {
    sets.push(`started_at = $${paramIdx}`);
    values.push(extra.startedAt);
    paramIdx++;
  }
  if (extra.finishedAt) {
    sets.push(`finished_at = $${paramIdx}`);
    values.push(extra.finishedAt);
    paramIdx++;
  }

  await pool.query(
    `UPDATE runs SET ${sets.join(", ")} WHERE id = $1`,
    values
  );
}

async function fetchQuarantineList(): Promise<string[]> {
  const result = await pool.query(
    "SELECT test_id FROM test_health WHERE quarantined = true"
  );
  return result.rows.map((r: { test_id: string }) => r.test_id);
}

/**
 * Persist a console log line for a run so the UI can stream it live. Any secret
 * values in `secrets` are scrubbed before the line is stored (#18) so target
 * credentials never surface in the console.
 */
async function appendLog(
  runId: string,
  stream: "system" | "stdout" | "stderr",
  message: string,
  secrets: Array<string | null | undefined> = []
) {
  const text = redactSecrets(message.replace(/\s+$/, ""), secrets);
  if (!text) return;
  try {
    await pool.query(
      "INSERT INTO run_logs (run_id, stream, message) VALUES ($1, $2, $3)",
      [runId, stream, text]
    );
  } catch (err) {
    // Never let logging failures break a run.
    console.error(`[Run ${runId}] failed to persist log:`, err);
  }
}

/** Buffer raw stream chunks and flush complete lines to run_logs (redacting secrets). */
function makeLineLogger(
  runId: string,
  stream: "stdout" | "stderr",
  secrets: Array<string | null | undefined> = []
) {
  let buffer = "";
  return {
    push(chunk: string) {
      buffer += chunk;
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (line.trim().length > 0) void appendLog(runId, stream, line, secrets);
      }
    },
    flush() {
      if (buffer.trim().length > 0) void appendLog(runId, stream, buffer, secrets);
      buffer = "";
    },
  };
}

async function processRun(job: Job<RunJobData>) {
  const { runId, selector, testIds, grafanaVersion, commitSha, target, envOverrides, shards } =
    job.data;
  const envDir = path.join(PROJECT_ROOT, "env");

  const log = (msg: string) => {
    console.log(`[Run ${runId}] ${msg}`);
    return appendLog(runId, "system", msg);
  };

  console.log(`[Run ${runId}] Starting execution...`);
  await updateRunStatus(runId, "running", { startedAt: new Date() });
  await log("Run started.");

  // Remote-target runs test a deployed app and do NOT need the local Docker env.
  const isRemote = Boolean(target?.url);

  try {
    if (isRemote) {
      await log(`Targeting remote application: ${target!.url} (skipping local Docker env).`);
    } else {
      // Step 1: Ensure the deterministic environment is up
      await log("Bringing up ephemeral Docker environment...");
      execSync("docker compose up -d --wait", {
        cwd: envDir,
        stdio: "pipe",
        timeout: 120_000,
      });

      // Step 2: Wait for services to be healthy
      await log("Waiting for services to be healthy...");
      execSync("npx tsx scripts/wait-for-services.ts", {
        cwd: PROJECT_ROOT,
        stdio: "pipe",
        timeout: 60_000,
      });

      // Step 3: Seed data
      await log("Seeding VictoriaMetrics...");
      execSync("npx tsx tests/fixtures/seed.ts", {
        cwd: PROJECT_ROOT,
        stdio: "pipe",
        timeout: 60_000,
      });
    }

    // Step 4: Clone the external generated-tests repo
    const os = await import("os");
    const testRepoDir = fs.mkdtempSync(path.join(os.tmpdir(), `run-${runId.slice(0, 8)}-`));
    await log(`Cloning test repo ${TEST_REPO_URL} (branch ${TEST_REPO_BRANCH})...`);
    execSync(
      `git clone --depth 1 --branch ${TEST_REPO_BRANCH} ${TEST_REPO_URL} ${testRepoDir}`,
      { encoding: "utf-8", timeout: 120_000 }
    );
    if (commitSha && commitSha !== "HEAD") {
      try {
        execSync(`git fetch origin ${commitSha} && git checkout ${commitSha}`, {
          cwd: testRepoDir, encoding: "utf-8", timeout: 60_000,
        });
      } catch {
        await log(`Could not checkout ${commitSha}, using branch HEAD.`);
      }
    }

    // Step 5: Install dependencies in the cloned test repo
    await log("Installing test repo dependencies...");
    try {
      execSync("npm ci --ignore-scripts", { cwd: testRepoDir, stdio: "pipe", timeout: 120_000 });
    } catch {
      execSync("npm install --ignore-scripts", { cwd: testRepoDir, stdio: "pipe", timeout: 120_000 });
    }

    // Step 5b: SSO session injection (#1) — write the captured storageState into
    // the cloned repo so app_tests' auth setup reuses the session unattended.
    if (target?.storageState) {
      try {
        const statePath = resolveAuthStatePath(testRepoDir);
        fs.mkdirSync(path.dirname(statePath), { recursive: true });
        fs.writeFileSync(statePath, target.storageState, "utf-8");
        await log("Injected captured SSO session (storageState) for authentication.");
      } catch (err) {
        await log(
          `Warning: failed to write injected auth state: ${
            err instanceof Error ? err.message : String(err)
          }`
        );
      }
    }

    // Step 6: Fetch quarantine list
    const quarantined = await fetchQuarantineList();
    if (quarantined.length > 0) {
      await log(
        `Auto-skipping ${quarantined.length} quarantined test(s): ${quarantined
          .map((id) => (id.includes("::") ? id.slice(id.indexOf("::") + 2) : id))
          .join(", ")}` +
          (testIds && testIds.length > 0
            ? " (explicitly selected tests are still run)"
            : "")
      );
    } else {
      await log("No quarantined tests.");
    }

    // Step 7: Build the shard plan (#13). A run may be split across N Playwright
    // shards executed in parallel; each shard runs a disjoint slice of tests and
    // writes results under the same RUN_ID, so the merge is implicit in the DB.
    // Quarantined tests are excluded via --grep-invert unless explicitly picked.
    // Pin the app_tests config so runs look for tests under app_tests/.
    const shardTotal = resolveShardCount(shards ?? process.env.SHARDS);
    const shardPlan = buildShardPlan(
      { config: TEST_CONFIG, selector, testIds, quarantine: quarantined },
      shardTotal
    );
    if (shardTotal > 1) {
      await log(`Sharding this run across ${shardTotal} parallel workers.`);
    }

    const runEnv = buildRunEnvOverrides(envOverrides);
    const overrideKeys = Object.keys(runEnv);
    if (overrideKeys.length > 0) {
      await log(`Applying per-run overrides: ${overrideKeys.join(", ")}.`);
    }
    const testEnv = {
      ...process.env,
      STORE_RESULTS: "true",
      RUN_ID: runId,
      COMMIT_SHA: commitSha,
      GRAFANA_VERSION: grafanaVersion,
      TRIGGER_SOURCE: job.data.triggerSource,
      TEST_SELECTOR: selector,
      QUARANTINE_LIST: quarantined.join(","),
      // Per-run environment overrides: viewport / timezone / time range (#15).
      ...runEnv,
      // Remote target + auth overrides (only set when a target URL is provided)
      ...buildTargetEnv(target),
    };

    // Secrets to scrub from any captured console output (#18).
    const logSecrets = [target?.password, target?.token];

    // Step 8: Run each shard (in parallel) from the cloned test repo.
    const runShard = (plan: (typeof shardPlan)[number]) =>
      new Promise<{ code: number; output: string }>((resolve) => {
        const tag = plan.shard ? `shard ${plan.shard} ` : "";
        void log(
          `Running ${tag}: npx ${plan.args.join(" ")}` +
            (target?.url ? ` against ${target.url}` : " against local env")
        );
        const stdoutLogger = makeLineLogger(runId, "stdout", logSecrets);
        const stderrLogger = makeLineLogger(runId, "stderr", logSecrets);
        let output = "";
        const proc = spawn("npx", plan.args, {
          cwd: testRepoDir,
          env: testEnv,
          stdio: ["pipe", "pipe", "pipe"],
        });
        proc.stdout?.on("data", (data: Buffer) => {
          const s = data.toString();
          output += s;
          stdoutLogger.push(s);
        });
        proc.stderr?.on("data", (data: Buffer) => {
          const s = data.toString();
          output += s;
          stderrLogger.push(s);
        });
        proc.on("close", (code) => {
          stdoutLogger.flush();
          stderrLogger.flush();
          resolve({ code: code ?? 1, output });
        });
      });

    const shardResults = await Promise.all(shardPlan.map(runShard));

    // Clean up cloned repo
    try { fs.rmSync(testRepoDir, { recursive: true, force: true }); } catch { /* ignore */ }

    const codes = shardResults.map((r) => r.code);
    const finalStatus = mergeShardStatuses(codes);
    await log(
      shardTotal > 1
        ? `All ${shardTotal} shards finished (exit codes: ${codes.join(", ")}) → ${finalStatus}.`
        : `Playwright exited with code ${codes[0]} → ${finalStatus}.`
    );

    await updateRunStatus(runId, finalStatus, { finishedAt: new Date() });

    const mergedOutput = shardResults.map((r) => r.output).join("\n");
    return { status: finalStatus, output: mergedOutput.slice(-2000) };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error(`[Run ${runId}] Error: ${message}`);
    await appendLog(runId, "stderr", `Run errored: ${message}`);
    if (!isRemote && /docker/i.test(message)) {
      await appendLog(
        runId,
        "system",
        "Hint: local runs require Docker. Provide a Target Application URL to run against a remote deployment without Docker."
      );
    }
    await updateRunStatus(runId, "error", { finishedAt: new Date() });
    throw err;
  }
}

// Start the worker
const connection = new IORedis(REDIS_URL, { maxRetriesPerRequest: null }) as any;

const worker = new Worker<RunJobData>("test-runs", processRun, {
  connection,
  concurrency: 1, // One run at a time per worker
  limiter: {
    max: 1,
    duration: 1000,
  },
});

worker.on("completed", (job) => {
  console.log(`[Worker] Job ${job.id} completed`);
});

worker.on("failed", (job, err) => {
  console.error(`[Worker] Job ${job?.id} failed:`, err.message);
});

console.log("Orchestrator worker started. Waiting for jobs...");

// Graceful shutdown
process.on("SIGTERM", async () => {
  await worker.close();
  await pool.end();
  process.exit(0);
});
