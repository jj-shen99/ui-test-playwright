/**
 * Tests API routes.
 * GET  /api/tests/:testId/history — per-test history (FR-15)
 * GET  /api/tests/catalog        — execution history (from run results) with derived + effective type
 * GET    /api/tests/app-tests    — tests discovered on disk under app_tests/
 * PUT    /api/tests/type         — set a user type override for a test
 * POST   /api/tests/upload       — upload a spec file into the catalog
 * DELETE /api/tests/app-tests    — remove a spec file under app_tests/
 */

import { type FastifyPluginAsync } from "fastify";
import fs from "fs";
import path from "path";
import { db } from "../../../db/connection";
import { testResults, runs, testTypeOverrides, testHealth } from "../../../db/schema";
import { eq, desc, sql, like } from "drizzle-orm";
import {
  VALID_TEST_TYPES,
  type TestType,
  discoverAppTests,
  parseTestTitles,
  deriveTypeFromSource,
  sanitizeSpecFileName,
  removeTestByTitle,
  renameTestInSource,
  APP_TESTS_DIR,
  UPLOADED_DIR,
  PROJECT_ROOT,
} from "./test-discovery";
import { requireAdmin } from "./rbac";
import { recordAudit, AuditAction } from "./audit";
import {
  isGitBackedEnabled,
  buildCommitMessage,
  commitTestMutation,
  type GitFileChange,
} from "../../shared/git";

/**
 * Best-effort git commit for a test mutation (#6). No-op unless
 * GIT_BACKED_TESTS is enabled. Never throws — the on-disk change has already
 * been applied, so a git failure is logged and swallowed.
 */
function gitCommitMutation(
  app: { log: { info: (o: unknown, m?: string) => void; warn: (o: unknown, m?: string) => void } },
  action: "upload" | "delete" | "rename",
  target: string,
  changes: GitFileChange[],
  detail?: string
): void {
  if (!isGitBackedEnabled()) return;
  const result = commitTestMutation({
    repoRoot: PROJECT_ROOT,
    changes,
    message: buildCommitMessage(action, target, detail),
  });
  if (result.committed) {
    app.log.info(
      { action, target, pushed: result.pushed },
      `git-backed test mutation committed${result.pushed ? " and pushed" : ""}`
    );
  } else if (result.error) {
    app.log.warn({ action, target, error: result.error }, "git-backed test mutation failed");
  }
}

/** Load all type overrides as a testId -> testType map. */
async function loadOverrides(): Promise<Map<string, string>> {
  const rows = await db
    .select({ testId: testTypeOverrides.testId, testType: testTypeOverrides.testType })
    .from(testTypeOverrides);
  return new Map(rows.map((r) => [r.testId, r.testType]));
}

export const testsRoutes: FastifyPluginAsync = async (app) => {
  // GET /api/tests/:testId/history — per-test history across runs (FR-15)
  app.get<{
    Params: { testId: string };
    Querystring: { limit?: string };
  }>("/tests/:testId/history", async (request) => {
    const limit = Math.min(Number(request.query.limit) || 200, 500);
    const testId = decodeURIComponent(request.params.testId);

    const results = await db
      .select({
        id: testResults.id,
        runId: testResults.runId,
        status: testResults.status,
        durationMs: testResults.durationMs,
        retryCount: testResults.retryCount,
        failureSignature: testResults.failureSignature,
        createdAt: testResults.createdAt,
        commitSha: runs.commitSha,
        grafanaVersion: runs.grafanaVersion,
      })
      .from(testResults)
      .innerJoin(runs, eq(testResults.runId, runs.id))
      .where(eq(testResults.testId, testId))
      .orderBy(desc(testResults.createdAt))
      .limit(limit);

    return { testId, history: results };
  });

  // GET /api/tests/catalog — all unique test IDs with latest status
  app.get("/tests/catalog", async () => {
    const catalog = await db
      .select({
        testId: testResults.testId,
        lastStatus: sql<string>`(array_agg(${testResults.status} ORDER BY ${testResults.createdAt} DESC))[1]`,
        runCount: sql<number>`count(*)`,
        avgDurationMs: sql<number>`avg(${testResults.durationMs})`,
        lastRun: sql<string>`max(${testResults.createdAt})`,
        derivedType: sql<string>`CASE
          WHEN ${testResults.testId} LIKE 'smoke/%' THEN 'smoke'
          WHEN ${testResults.testId} LIKE 'sanity/%' THEN 'sanity'
          WHEN ${testResults.testId} LIKE 'regression/%' THEN 'regression'
          WHEN ${testResults.testId} LIKE 'e2e/%' THEN 'e2e'
          ELSE 'unknown'
        END`,
      })
      .from(testResults)
      .groupBy(testResults.testId)
      .orderBy(testResults.testId);

    const overrides = await loadOverrides();

    const tests = catalog.map((t) => {
      const override = overrides.get(t.testId);
      return {
        ...t,
        testType: override ?? t.derivedType,
        overridden: override !== undefined,
      };
    });

    return { tests };
  });

  // GET /api/tests/health — ML-maintained flakiness/quarantine map for badges (#10)
  app.get("/tests/health", async () => {
    const rows = await db
      .select({
        testId: testHealth.testId,
        flakinessScore: testHealth.flakinessScore,
        quarantined: testHealth.quarantined,
        updatedAt: testHealth.updatedAt,
      })
      .from(testHealth);

    const health: Record<
      string,
      { flakinessScore: number; quarantined: boolean; updatedAt: string }
    > = {};
    for (const r of rows) {
      health[r.testId] = {
        flakinessScore: r.flakinessScore,
        quarantined: r.quarantined,
        updatedAt: String(r.updatedAt),
      };
    }
    return { health };
  });

  // GET /api/tests/app-tests — tests discovered on disk under app_tests/
  app.get("/tests/app-tests", async () => {
    const discovered = discoverAppTests();
    const overrides = await loadOverrides();

    const tests = discovered.map((t) => {
      const override = overrides.get(t.testId);
      return {
        testId: t.testId,
        file: t.file,
        title: t.title,
        caseName: t.caseName,
        derivedType: t.derivedType,
        testType: override ?? t.derivedType,
        overridden: override !== undefined,
      };
    });

    return { tests };
  });

  // GET /api/tests/source?file=<relFile> — return the raw script for a spec file
  // so the UI can display it. Guarded to files under app_tests/.
  app.get<{ Querystring: { file?: string } }>(
    "/tests/source",
    async (request, reply) => {
      const file = request.query.file;
      if (!file || typeof file !== "string") {
        return reply.badRequest("file query parameter is required");
      }

      // Resolve and guard: the target must live inside app_tests/.
      const abs = path.resolve(PROJECT_ROOT, file);
      if (abs !== APP_TESTS_DIR && !abs.startsWith(APP_TESTS_DIR + path.sep)) {
        return reply.badRequest("file must be located under app_tests/");
      }
      if (!/\.spec\.ts$/.test(abs)) {
        return reply.badRequest("file must be a .spec.ts file");
      }
      if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
        return reply.notFound(`No such test file: ${file}`);
      }

      const content = fs.readFileSync(abs, "utf-8");
      return { file: path.relative(PROJECT_ROOT, abs), content };
    }
  );

  // PUT /api/tests/type — set (or clear) a user type override for a test
  app.put<{
    Body: { testId: string; testType: string };
  }>("/tests/type", async (request, reply) => {
    const { testId, testType } = request.body || {};

    if (!testId || typeof testId !== "string") {
      return reply.badRequest("testId is required");
    }
    if (!VALID_TEST_TYPES.includes(testType as TestType)) {
      return reply.badRequest(
        `testType must be one of: ${VALID_TEST_TYPES.join(", ")}`
      );
    }

    await db
      .insert(testTypeOverrides)
      .values({ testId, testType, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: testTypeOverrides.testId,
        set: { testType, updatedAt: new Date() },
      });

    return { testId, testType };
  });

  // DELETE /api/tests/app-tests — remove a spec file (and its type overrides) (admin only)
  app.delete<{
    Body: { file: string };
  }>("/tests/app-tests", { preHandler: requireAdmin }, async (request, reply) => {
    const { file } = request.body || {};

    if (!file || typeof file !== "string") {
      return reply.badRequest("file is required");
    }

    // Resolve and guard: the target must live inside app_tests/.
    const abs = path.resolve(PROJECT_ROOT, file);
    if (abs !== APP_TESTS_DIR && !abs.startsWith(APP_TESTS_DIR + path.sep)) {
      return reply.badRequest("file must be located under app_tests/");
    }
    if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
      return reply.notFound(`No such test file: ${file}`);
    }

    fs.rmSync(abs);

    // Clear any type overrides that belonged to tests in this file.
    const relFile = path.relative(PROJECT_ROOT, abs);
    await db
      .delete(testTypeOverrides)
      .where(like(testTypeOverrides.testId, `${relFile}::%`));

    gitCommitMutation(app, "delete", relFile, [{ file: relFile, op: "remove" }]);

    await recordAudit(request, {
      action: AuditAction.TEST_DELETE,
      targetType: "test",
      targetId: relFile,
      detail: `Deleted spec file ${relFile}`,
    });

    return { deleted: relFile };
  });

  // DELETE /api/tests/single — excise one test() from a spec file (admin only).
  // If the file has no remaining tests afterwards, the file is removed.
  app.delete<{
    Body: { testId: string };
  }>("/tests/single", { preHandler: requireAdmin }, async (request, reply) => {
    const { testId } = request.body || {};

    if (!testId || typeof testId !== "string") {
      return reply.badRequest("testId is required");
    }
    const sep = testId.indexOf("::");
    if (sep < 0) {
      return reply.badRequest("testId must be in '<file>::<title>' form");
    }
    const file = testId.slice(0, sep);
    const title = testId.slice(sep + 2);
    if (!title) return reply.badRequest("testId is missing a test title");

    // Resolve and guard: the target must live inside app_tests/.
    const abs = path.resolve(PROJECT_ROOT, file);
    if (abs !== APP_TESTS_DIR && !abs.startsWith(APP_TESTS_DIR + path.sep)) {
      return reply.badRequest("file must be located under app_tests/");
    }
    if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
      return reply.notFound(`No such test file: ${file}`);
    }

    const source = fs.readFileSync(abs, "utf-8");
    const result = removeTestByTitle(source, title);
    if (!result) {
      return reply.notFound(`Test not found in ${file}: ${title}`);
    }

    const relFile = path.relative(PROJECT_ROOT, abs);
    let fileDeleted = false;
    if (result.remaining === 0) {
      // No tests left — remove the file and all its overrides.
      fs.rmSync(abs);
      fileDeleted = true;
      await db
        .delete(testTypeOverrides)
        .where(like(testTypeOverrides.testId, `${relFile}::%`));
    } else {
      fs.writeFileSync(abs, result.source, "utf-8");
      await db.delete(testTypeOverrides).where(eq(testTypeOverrides.testId, testId));
    }

    gitCommitMutation(
      app,
      "delete",
      relFile,
      [{ file: relFile, op: fileDeleted ? "remove" : "add" }],
      `test: ${title}`
    );

    await recordAudit(request, {
      action: AuditAction.TEST_DELETE,
      targetType: "test",
      targetId: testId,
      detail: fileDeleted
        ? `Deleted test "${title}" (last in ${relFile}; file removed)`
        : `Deleted test "${title}" from ${relFile}`,
    });

    return { deleted: testId, file: relFile, remaining: result.remaining, fileDeleted };
  });

  // PATCH /api/tests/rename — rename a single test's title in place (admin).
  // Rewrites only the title literal and migrates the test's type override and
  // ML health row to the new testId (#7).
  app.patch<{
    Body: { testId: string; newTitle: string };
  }>("/tests/rename", { preHandler: requireAdmin }, async (request, reply) => {
    const { testId, newTitle } = request.body || {};

    if (!testId || typeof testId !== "string") {
      return reply.badRequest("testId is required");
    }
    if (!newTitle || typeof newTitle !== "string" || !newTitle.trim()) {
      return reply.badRequest("newTitle is required");
    }
    const sep = testId.indexOf("::");
    if (sep < 0) {
      return reply.badRequest("testId must be in '<file>::<title>' form");
    }
    const file = testId.slice(0, sep);
    const oldTitle = testId.slice(sep + 2);
    if (!oldTitle) return reply.badRequest("testId is missing a test title");

    const abs = path.resolve(PROJECT_ROOT, file);
    if (abs !== APP_TESTS_DIR && !abs.startsWith(APP_TESTS_DIR + path.sep)) {
      return reply.badRequest("file must be located under app_tests/");
    }
    if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
      return reply.notFound(`No such test file: ${file}`);
    }

    const source = fs.readFileSync(abs, "utf-8");
    const result = renameTestInSource(source, oldTitle, newTitle.trim());
    if ("error" in result) {
      switch (result.error) {
        case "not-found":
          return reply.notFound(`Test not found in ${file}: ${oldTitle}`);
        case "duplicate":
          return reply.conflict(`A test titled "${newTitle.trim()}" already exists in ${file}`);
        case "unchanged":
          return reply.badRequest("newTitle is the same as the current title");
        case "invalid":
          return reply.badRequest("newTitle contains characters that can't be used in a title");
        default:
          return reply.badRequest("newTitle is required");
      }
    }

    fs.writeFileSync(abs, result.source, "utf-8");

    const relFile = path.relative(PROJECT_ROOT, abs);
    const newTestId = `${relFile}::${newTitle.trim()}`;

    // Migrate the type override and ML health row to the new testId, taking
    // care not to collide with a pre-existing row for the new id.
    await db.delete(testTypeOverrides).where(eq(testTypeOverrides.testId, newTestId));
    await db
      .update(testTypeOverrides)
      .set({ testId: newTestId })
      .where(eq(testTypeOverrides.testId, testId));
    await db.delete(testHealth).where(eq(testHealth.testId, newTestId));
    await db
      .update(testHealth)
      .set({ testId: newTestId })
      .where(eq(testHealth.testId, testId));

    gitCommitMutation(
      app,
      "rename",
      relFile,
      [{ file: relFile, op: "add" }],
      `"${oldTitle}" → "${newTitle.trim()}"`
    );

    await recordAudit(request, {
      action: AuditAction.TEST_UPDATE,
      targetType: "test",
      targetId: testId,
      detail: `Renamed test "${oldTitle}" → "${newTitle.trim()}" in ${relFile}`,
    });

    return { renamed: testId, newTestId, file: relFile };
  });

  // POST /api/tests/upload — upload a Playwright spec file into the catalog
  app.post<{
    Body: { fileName: string; content: string; testType?: string };
  }>("/tests/upload", async (request, reply) => {
    const { fileName, content, testType } = request.body || {};

    if (!content || typeof content !== "string" || !content.trim()) {
      return reply.badRequest("content is required");
    }

    const safeName = sanitizeSpecFileName(fileName || "");
    if (!safeName) {
      return reply.badRequest(
        "Invalid file name — use a .spec.ts file with letters, numbers, '.', '_' or '-' only"
      );
    }

    // Must contain at least one Playwright test() to be catalog-worthy.
    const titles = parseTestTitles(content);
    if (titles.length === 0) {
      return reply.badRequest("No Playwright test() found in the uploaded file");
    }

    // Optional explicit type must be valid if provided.
    if (testType !== undefined && !VALID_TEST_TYPES.includes(testType as TestType)) {
      return reply.badRequest(
        `testType must be one of: ${VALID_TEST_TYPES.join(", ")}`
      );
    }

    fs.mkdirSync(UPLOADED_DIR, { recursive: true });
    const dest = path.join(UPLOADED_DIR, safeName);
    const alreadyExisted = fs.existsSync(dest);
    fs.writeFileSync(dest, content, "utf-8");

    const relFile = path.relative(PROJECT_ROOT, dest);
    const derivedType = deriveTypeFromSource(content);
    const effectiveType =
      testType && VALID_TEST_TYPES.includes(testType as TestType)
        ? testType
        : derivedType;

    // Persist an explicit type override when one was requested.
    if (testType && VALID_TEST_TYPES.includes(testType as TestType)) {
      for (const title of titles) {
        const testId = `${relFile}::${title}`;
        await db
          .insert(testTypeOverrides)
          .values({ testId, testType, updatedAt: new Date() })
          .onConflictDoUpdate({
            target: testTypeOverrides.testId,
            set: { testType, updatedAt: new Date() },
          });
      }
    }

    // Uploaded specs live under a normally-ignored runtime dir, so force-add
    // them when git-backed mode is on to ensure they reach remote clones (#6).
    gitCommitMutation(app, "upload", relFile, [{ file: relFile, op: "add", force: true }]);

    return reply.status(alreadyExisted ? 200 : 201).send({
      file: relFile,
      replaced: alreadyExisted,
      testCount: titles.length,
      derivedType,
      testType: effectiveType,
      tests: titles.map((title) => ({ testId: `${relFile}::${title}`, title })),
    });
  });
};
