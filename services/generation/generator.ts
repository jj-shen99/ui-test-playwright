/**
 * Generation service (§8.1).
 * Orchestrates: parse → generate specs → write files → open PR (FR-1–FR-6).
 */

import fs from "fs";
import path from "path";
import { parseDashboard } from "./parser";
import { generateSpecs, type GeneratedFile } from "./templates";
import { generateWithLlm } from "./llm-generator";
import { reviewLlmDraft } from "./review";

const GRAFANA_URL = process.env.GRAFANA_URL || "http://localhost:3000";
const GRAFANA_USER = process.env.GRAFANA_USER || "admin";
const GRAFANA_PASSWORD = process.env.GRAFANA_PASSWORD || "admin";
const PROJECT_ROOT = process.env.PROJECT_ROOT || path.resolve(__dirname, "../..");
const TEST_REPO_URL =
  process.env.TEST_REPO_URL ||
  "https://code.devsnc.com/jianjun-shen/grafana-ui-testing";
const TEST_REPO_BRANCH = process.env.TEST_REPO_BRANCH || "main";
const TESTS_DIR = path.join(PROJECT_ROOT, "tests");
// Generated specs are committed under this directory in the target repo.
const GENERATED_SUBDIR = "app_tests/generated";
// Unapproved LLM drafts land here for human review instead of the active suite (#22).
const LLM_REVIEW_SUBDIR = ".llm-review";

export interface GenerateTarget {
  url?: string;
  authType?: "none" | "basic" | "token";
  username?: string;
  password?: string;
  token?: string;
}

export interface GenerateOptions {
  dashboardUid?: string;
  dashboardJson?: Record<string, unknown>;
  useLlm?: boolean;
  /** Approve LLM drafts so they are written into the active suite (#22). */
  approveLlm?: boolean;
  testType?: string;
  seedInstanceCount?: number;
  target?: GenerateTarget;
}

export interface GenerateResult {
  files: string[];
  prUrl: string | null;
  /** Reviewer-facing summaries for LLM drafts that were not auto-enabled (#22). */
  reviews?: string[];
}

/** Main generation entry point */
export async function generateTests(
  options: GenerateOptions
): Promise<GenerateResult> {
  // Step 1: Get the dashboard JSON
  let dashboardJson = options.dashboardJson;
  if (!dashboardJson && options.dashboardUid) {
    dashboardJson = await fetchDashboardJson(options.dashboardUid, options.target);
  }

  if (!dashboardJson) {
    throw new Error("No dashboard JSON provided or fetched");
  }

  // Step 2: Parse
  const parsed = parseDashboard(dashboardJson);
  console.log(
    `Parsed dashboard "${parsed.title}" (${parsed.uid}): ${parsed.panels.length} panels, ${parsed.variables.length} variables`
  );

  // Step 3: Generate specs from templates
  const specs = generateSpecs(parsed, options.seedInstanceCount || 3);

  // Step 4: Write files (idempotent)
  const testType = options.testType || "smoke";
  const writtenFiles = writeSpecFiles(specs, testType);

  // Step 5: Optionally generate LLM-assisted draft specs, guarded by a
  // review/diff gate (#22). Drafts are validated and diffed; only approved,
  // valid drafts are written into the active suite (and thus the PR). Everything
  // else lands in a review directory with a summary for a human to inspect.
  const reviews: string[] = [];
  if (options.useLlm) {
    try {
      const llmSpecs = await generateWithLlm(parsed, dashboardJson);
      const enabled = reviewAndWriteLlmDrafts(llmSpecs, Boolean(options.approveLlm), reviews);
      writtenFiles.push(...enabled);
    } catch (err) {
      console.warn(
        "LLM generation failed (non-blocking):",
        err instanceof Error ? err.message : err
      );
    }
  }

  // Step 6: Open PR (FR-5) — create a branch, commit, push, and return PR URL
  const prUrl = await openPullRequest(parsed.uid, writtenFiles);

  return { files: writtenFiles, prUrl, reviews: reviews.length ? reviews : undefined };
}

/**
 * Run each LLM draft through the review/diff gate (#22). Approved, valid drafts
 * are written into the active suite and their relative paths returned so they
 * flow into the PR. Blocked or unapproved drafts are written to the review
 * directory instead, and a summary line is pushed into `reviews`.
 */
function reviewAndWriteLlmDrafts(
  drafts: GeneratedFile[],
  approve: boolean,
  reviews: string[]
): string[] {
  const enabled: string[] = [];

  for (const draft of drafts) {
    const activePath = path.join(TESTS_DIR, draft.path);
    const existing = fs.existsSync(activePath)
      ? fs.readFileSync(activePath, "utf-8")
      : null;

    const outcome = reviewLlmDraft({
      rawContent: draft.content,
      existingContent: existing,
      approve,
      path: draft.path,
    });
    reviews.push(outcome.summary);
    console.log(`  LLM review — ${outcome.summary}`);

    if (outcome.approved) {
      // Write into the active suite; goes into the PR like any generated spec.
      fs.mkdirSync(path.dirname(activePath), { recursive: true });
      fs.writeFileSync(activePath, outcome.code, "utf-8");
      enabled.push(draft.path);
      console.log(`  Wrote (approved): ${draft.path}`);
    } else {
      // Park the draft for human review; never enters the active suite/PR.
      const reviewPath = path.join(TESTS_DIR, LLM_REVIEW_SUBDIR, draft.path);
      fs.mkdirSync(path.dirname(reviewPath), { recursive: true });
      fs.writeFileSync(reviewPath, outcome.code, "utf-8");
      console.log(
        `  Parked for review: ${path.join(LLM_REVIEW_SUBDIR, draft.path)}`
      );
    }
  }

  return enabled;
}

/** Fetch dashboard JSON from the Grafana API (optionally a remote target). */
async function fetchDashboardJson(
  uid: string,
  target?: GenerateTarget
): Promise<Record<string, unknown>> {
  const baseUrl = (target?.url || GRAFANA_URL).replace(/\/+$/, "");

  // Build the Authorization header based on the requested auth type.
  let authorization: string;
  if (target?.authType === "token" && target.token) {
    authorization = `Bearer ${target.token}`;
  } else {
    const user =
      target?.authType === "basic" && target.username ? target.username : GRAFANA_USER;
    const pass =
      target?.authType === "basic" && target.password ? target.password : GRAFANA_PASSWORD;
    authorization = `Basic ${Buffer.from(`${user}:${pass}`).toString("base64")}`;
  }

  const resp = await fetch(`${baseUrl}/api/dashboards/uid/${uid}`, {
    headers: { Authorization: authorization },
  });

  if (!resp.ok) {
    throw new Error(
      `Failed to fetch dashboard ${uid} from ${baseUrl}: ${resp.status} ${resp.statusText}`
    );
  }

  const data = (await resp.json()) as { dashboard: Record<string, unknown> };
  return data.dashboard;
}

/**
 * Clone the external test repo into a temp directory.
 * Returns the path to the cloned repo.
 */
async function cloneTestRepo(): Promise<string> {
  const { execSync } = await import("child_process");
  const os = await import("os");
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "test-repo-"));

  console.log(`  Cloning ${TEST_REPO_URL} (branch: ${TEST_REPO_BRANCH})...`);
  execSync(
    `git clone --depth 1 --branch ${TEST_REPO_BRANCH} ${TEST_REPO_URL} ${tmpDir}`,
    { encoding: "utf-8", timeout: 60_000 }
  );

  return tmpDir;
}

/**
 * Write generated spec files into the external test repo,
 * create a branch, commit, push, and return the PR URL (FR-5).
 */
async function openPullRequest(
  dashboardUid: string,
  localFiles: string[]
): Promise<string | null> {
  if (localFiles.length === 0) return null;

  const { execSync } = await import("child_process");
  let repoDir: string | null = null;

  try {
    // Clone the external test repo
    repoDir = await cloneTestRepo();
    const opts = { cwd: repoDir, encoding: "utf-8" as const };
    const branchName = `generated/${dashboardUid}-${Date.now()}`;

    // Create a new branch
    execSync(`git checkout -b ${branchName}`, opts);

    // Copy generated files from local tests dir into the cloned repo,
    // placing them under app_tests/generated/<uid>/ in the target repo.
    for (const relPath of localFiles) {
      const src = path.join(TESTS_DIR, relPath);
      const destDir = path.join(repoDir, GENERATED_SUBDIR, dashboardUid);
      const dest = path.join(destDir, path.basename(relPath));

      fs.mkdirSync(destDir, { recursive: true });
      fs.copyFileSync(src, dest);
      execSync(`git add ${GENERATED_SUBDIR}/${dashboardUid}/${path.basename(relPath)}`, opts);
    }

    // Commit
    execSync(
      `git commit -m "feat(generated): update tests for dashboard ${dashboardUid}"`,
      opts
    );

    // Push
    execSync(`git push -u origin ${branchName}`, opts);

    // Construct PR URL
    const baseUrl = TEST_REPO_URL
      .replace(/\.git$/, "")
      .replace(/^git@([^:]+):/, "https://$1/");
    const prUrl = `${baseUrl}/compare/${TEST_REPO_BRANCH}...${branchName}?expand=1`;

    console.log(`  PR branch pushed to test repo: ${branchName}`);
    console.log(`  Create PR: ${prUrl}`);
    return prUrl;
  } catch (err) {
    console.warn(
      "  PR creation failed (non-blocking):",
      err instanceof Error ? err.message : err
    );
    return null;
  } finally {
    // Clean up temp clone
    if (repoDir) {
      try {
        fs.rmSync(repoDir, { recursive: true, force: true });
      } catch { /* ignore cleanup failures */ }
    }
  }
}

/** Write generated spec files to disk (idempotent by path) */
function writeSpecFiles(files: GeneratedFile[], testType?: string): string[] {
  const written: string[] = [];

  for (const file of files) {
    // Prefix path with test type subdirectory when provided
    const relPath = testType
      ? path.join(testType, file.path)
      : file.path;
    const fullPath = path.join(TESTS_DIR, relPath);
    const dir = path.dirname(fullPath);

    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(fullPath, file.content, "utf-8");

    written.push(relPath);
    console.log(`  Wrote: ${relPath}`);
  }

  return written;
}
