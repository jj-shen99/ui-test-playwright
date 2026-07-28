/**
 * Runs API routes — §10 contracts.
 * POST /api/runs        → trigger a run (FR-7)
 * GET  /api/runs        → recent runs (FR-14)
 * GET  /api/runs/:id    → run detail (FR-16)
 * GET  /api/runs/:id/results → per-test results
 */

import { type FastifyPluginAsync } from "fastify";
import { db } from "../../../db/connection";
import { runs, testResults, artifacts, runLogs } from "../../../db/schema";
import { eq, desc, sql, and, gt, asc, inArray } from "drizzle-orm";
import { randomUUID } from "crypto";
import { Queue } from "bullmq";
import { Redis as IORedis } from "ioredis";
import { requireAdmin } from "./rbac";
import { recordAudit, AuditAction } from "./audit";
import { classifyArtifact } from "../../shared/artifacts";
import { getArtifactUrl } from "../../shared/s3-client";

const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

let runQueue: Queue | null = null;
function getRunQueue(): Queue {
  if (!runQueue) {
    const connection = new IORedis(REDIS_URL, { maxRetriesPerRequest: null }) as any;
    runQueue = new Queue("test-runs", { connection });
  }
  return runQueue;
}

export const runsRoutes: FastifyPluginAsync = async (app) => {
  // POST /api/runs — trigger a run (FR-7)
  app.post<{
    Body: {
      selector?: string;
      testIds?: string[];
      grafanaVersion?: string;
      commitSha?: string;
      triggerSource?: string;
      targetUrl?: string;
      authType?: "none" | "basic" | "token";
      authUsername?: string;
      authPassword?: string;
      authToken?: string;
      envOverrides?: {
        viewportWidth?: number;
        viewportHeight?: number;
        timezone?: string;
        timeFrom?: string;
        timeTo?: string;
      };
      shards?: number;
    };
  }>("/runs", async (request, reply) => {
    const {
      selector: rawSelector = "all",
      testIds,
      grafanaVersion = "11.4.0",
      commitSha = "HEAD",
      triggerSource = "manual",
      targetUrl,
      authType = "none",
      authUsername,
      authPassword,
      authToken,
      envOverrides,
      shards,
    } = request.body || {};

    // When specific tests are selected, they take precedence over the preset.
    const selectedTestIds = Array.isArray(testIds)
      ? testIds.filter((t) => typeof t === "string" && t.trim().length > 0)
      : [];

    // Human-readable selector persisted on the run record.
    const selector =
      selectedTestIds.length === 1
        ? selectedTestIds[0]
        : selectedTestIds.length > 1
        ? `${selectedTestIds.length} tests`
        : rawSelector;

    const runId = randomUUID();

    // Insert run record. NOTE: auth secrets are intentionally NOT persisted;
    // they are passed only through the (local) job queue.
    await db.insert(runs).values({
      id: runId,
      triggerSource,
      commitSha,
      grafanaVersion,
      selector,
      status: "queued",
    });

    // Enqueue the run job
    const queue = getRunQueue();
    await queue.add("execute-run", {
      runId,
      selector: rawSelector,
      testIds: selectedTestIds,
      grafanaVersion,
      commitSha,
      triggerSource,
      target: targetUrl
        ? {
            url: targetUrl,
            authType,
            username: authUsername,
            password: authPassword,
            token: authToken,
          }
        : undefined,
      envOverrides,
      shards: typeof shards === "number" ? shards : undefined,
    });

    await recordAudit(request, {
      action: AuditAction.RUN_TRIGGER,
      targetType: "run",
      targetId: runId,
      detail: `Triggered ${triggerSource} run (${selector})${
        targetUrl ? ` against ${targetUrl}` : ""
      }`,
    });

    return reply.status(202).send({ runId, status: "queued" });
  });

  // GET /api/runs — recent runs (FR-14)
  app.get<{
    Querystring: { limit?: string; status?: string };
  }>("/runs", async (request) => {
    const limit = Math.min(Number(request.query.limit) || 50, 200);
    const statusFilter = request.query.status;

    let query = db
      .select()
      .from(runs)
      .orderBy(desc(runs.createdAt))
      .limit(limit);

    if (statusFilter) {
      query = query.where(eq(runs.status, statusFilter)) as typeof query;
    }

    const results = await query;
    return { runs: results, total: results.length };
  });

  // GET /api/runs/:id — run detail (FR-16)
  app.get<{ Params: { id: string } }>("/runs/:id", async (request, reply) => {
    const result = await db
      .select()
      .from(runs)
      .where(eq(runs.id, request.params.id))
      .limit(1);

    if (result.length === 0) {
      return reply.notFound("Run not found");
    }

    // Get summary stats
    const stats = await db
      .select({
        total: sql<number>`count(*)`,
        passed: sql<number>`count(*) filter (where ${testResults.status} = 'passed')`,
        failed: sql<number>`count(*) filter (where ${testResults.status} = 'failed')`,
        skipped: sql<number>`count(*) filter (where ${testResults.status} = 'skipped')`,
        flaky: sql<number>`count(*) filter (where ${testResults.status} = 'flaky')`,
      })
      .from(testResults)
      .where(eq(testResults.runId, request.params.id));

    return { run: result[0], stats: stats[0] };
  });

  // GET /api/runs/:id/results — per-test results
  app.get<{ Params: { id: string } }>("/runs/:id/results", async (request) => {
    const results = await db
      .select()
      .from(testResults)
      .where(eq(testResults.runId, request.params.id))
      .orderBy(testResults.testId);

    return { results };
  });

  // GET /api/runs/:id/logs — streamed console output (incremental via ?after=seq)
  app.get<{
    Params: { id: string };
    Querystring: { after?: string; limit?: string };
  }>("/runs/:id/logs", async (request) => {
    const after = Number(request.query.after) || 0;
    const limit = Math.min(Number(request.query.limit) || 1000, 5000);

    const logs = await db
      .select({
        seq: runLogs.seq,
        stream: runLogs.stream,
        message: runLogs.message,
        createdAt: runLogs.createdAt,
      })
      .from(runLogs)
      .where(and(eq(runLogs.runId, request.params.id), gt(runLogs.seq, after)))
      .orderBy(asc(runLogs.seq))
      .limit(limit);

    const lastSeq = logs.length > 0 ? logs[logs.length - 1].seq : after;
    return { logs, lastSeq };
  });

  // DELETE /api/runs/:id — remove a run and all of its child records (admin only)
  app.delete<{ Params: { id: string } }>("/runs/:id", { preHandler: requireAdmin }, async (request, reply) => {
    const { id } = request.params;

    const existing = await db
      .select({ id: runs.id, status: runs.status })
      .from(runs)
      .where(eq(runs.id, id))
      .limit(1);

    if (existing.length === 0) {
      return reply.notFound("Run not found");
    }

    // Don't delete an in-flight run: the orchestrator is still writing to it.
    if (["queued", "running"].includes(existing[0].status)) {
      return reply.conflict(
        "Cannot delete a run that is queued or running. Wait for it to finish."
      );
    }

    // Delete child rows first (FKs are not ON DELETE CASCADE).
    const resultRows = await db
      .select({ id: testResults.id })
      .from(testResults)
      .where(eq(testResults.runId, id));
    const resultIds = resultRows.map((r) => r.id);

    if (resultIds.length > 0) {
      await db.delete(artifacts).where(inArray(artifacts.testResultId, resultIds));
    }
    await db.delete(testResults).where(eq(testResults.runId, id));
    await db.delete(runLogs).where(eq(runLogs.runId, id));
    await db.delete(runs).where(eq(runs.id, id));

    await recordAudit(request, {
      action: AuditAction.RUN_DELETE,
      targetType: "run",
      targetId: id,
      detail: `Deleted run and ${resultIds.length} result(s)`,
    });

    return { message: "Run deleted", id };
  });

  // GET /api/results/:id/artifacts — artifact URIs + viewer hint (FR-17, #9)
  app.get<{ Params: { id: string } }>(
    "/results/:id/artifacts",
    async (request) => {
      const results = await db
        .select()
        .from(artifacts)
        .where(eq(artifacts.testResultId, request.params.id));

      return {
        artifacts: results.map((a) => ({
          ...a,
          viewer: classifyArtifact(a.kind, a.objectUri),
        })),
      };
    }
  );

  // GET /api/artifacts/:id/url — short-lived pre-signed URL for inline viewing (#9)
  app.get<{ Params: { id: string } }>(
    "/artifacts/:id/url",
    async (request, reply) => {
      const rows = await db
        .select()
        .from(artifacts)
        .where(eq(artifacts.id, request.params.id))
        .limit(1);
      if (rows.length === 0) return reply.notFound("Artifact not found");

      try {
        const url = await getArtifactUrl(rows[0].objectUri);
        return {
          id: rows[0].id,
          kind: rows[0].kind,
          viewer: classifyArtifact(rows[0].kind, rows[0].objectUri),
          url,
        };
      } catch (err) {
        return reply.internalServerError(
          err instanceof Error ? err.message : "Failed to sign artifact URL"
        );
      }
    }
  );
};
