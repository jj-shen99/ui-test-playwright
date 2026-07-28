/**
 * Schedules API routes — test scheduling.
 * POST   /api/schedules          → create schedule
 * GET    /api/schedules          → list schedules
 * GET    /api/schedules/:id      → get schedule
 * PUT    /api/schedules/:id      → update schedule
 * DELETE /api/schedules/:id      → delete schedule
 * POST   /api/schedules/:id/run  → trigger a scheduled run immediately
 */

import { type FastifyPluginAsync } from "fastify";
import { db } from "../../../db/connection";
import { schedules } from "../../../db/schema";
import { eq, desc } from "drizzle-orm";
import { randomUUID } from "crypto";
import { requireAdmin } from "./rbac";
import { encryptOptional, maybeDecrypt } from "../../shared/crypto";
import { recordAudit, AuditAction } from "./audit";
import { loadResolvedProfile } from "./auth-profiles";

/**
 * Strip secret material from a schedule row before returning it over the API.
 * Callers get booleans indicating whether credentials are configured, never the
 * (encrypted) values themselves.
 */
export function stripScheduleSecrets<
  T extends { authPassword?: string | null; authToken?: string | null }
>(row: T): Omit<T, "authPassword" | "authToken"> & {
  hasPassword: boolean;
  hasToken: boolean;
} {
  const { authPassword, authToken, ...rest } = row;
  return {
    ...rest,
    hasPassword: Boolean(authPassword),
    hasToken: Boolean(authToken),
  };
}

/** Parse a cron expression and compute the next run time */
function computeNextRun(cronExpression: string): Date {
  // Simple cron parser for common patterns
  // Format: minute hour dayOfMonth month dayOfWeek
  const parts = cronExpression.trim().split(/\s+/);
  if (parts.length !== 5) {
    throw new Error("Invalid cron expression. Expected 5 fields: min hour dom month dow");
  }

  const now = new Date();
  const [min, hour] = parts;

  // For simple cases (specific hour/minute), compute next occurrence
  const nextRun = new Date(now);

  if (min !== "*" && hour !== "*") {
    nextRun.setHours(Number(hour), Number(min), 0, 0);
    if (nextRun <= now) {
      nextRun.setDate(nextRun.getDate() + 1);
    }
  } else {
    // Default: next hour
    nextRun.setHours(nextRun.getHours() + 1, 0, 0, 0);
  }

  return nextRun;
}

export const schedulesRoutes: FastifyPluginAsync = async (app) => {
  // POST /api/schedules — create a schedule
  app.post<{
    Body: {
      name: string;
      cronExpression: string;
      selector?: string;
      testIds?: string[];
      grafanaVersion?: string;
      targetUrl?: string;
      authType?: "none" | "basic" | "token";
      authUsername?: string;
      authPassword?: string;
      authToken?: string;
      authProfileId?: string;
      enabled?: boolean;
      createdBy?: string;
    };
  }>("/schedules", async (request, reply) => {
    const {
      name,
      cronExpression,
      selector = "all",
      testIds,
      grafanaVersion = "11.4.0",
      targetUrl,
      authType = "none",
      authUsername,
      authPassword,
      authToken,
      authProfileId,
      enabled = true,
      createdBy,
    } = request.body || {};

    if (!name || !cronExpression) {
      return reply.badRequest("name and cronExpression are required");
    }

    // Validate cron expression
    const parts = cronExpression.trim().split(/\s+/);
    if (parts.length !== 5) {
      return reply.badRequest(
        "Invalid cron expression. Expected 5 fields: minute hour dayOfMonth month dayOfWeek"
      );
    }

    const selectedTestIds = Array.isArray(testIds)
      ? testIds.filter((t) => typeof t === "string" && t.trim().length > 0)
      : [];

    // Persisted selector mirrors the runs route: individual tests override preset.
    const persistedSelector =
      selectedTestIds.length === 1
        ? selectedTestIds[0]
        : selectedTestIds.length > 1
        ? `${selectedTestIds.length} tests`
        : selector;

    const id = randomUUID();
    let nextRunAt: Date | null = null;

    if (enabled) {
      try {
        nextRunAt = computeNextRun(cronExpression);
      } catch (err) {
        return reply.badRequest(
          err instanceof Error ? err.message : "Invalid cron expression"
        );
      }
    }

    await db.insert(schedules).values({
      id,
      name,
      cronExpression,
      selector: persistedSelector,
      testIds: selectedTestIds.length > 0 ? JSON.stringify(selectedTestIds) : null,
      grafanaVersion,
      targetUrl: targetUrl?.trim() || null,
      authType,
      authUsername: authUsername?.trim() || null,
      // Secrets encrypted at rest (#2).
      authPassword: encryptOptional(authPassword),
      authToken: encryptOptional(authToken?.trim()),
      authProfileId: authProfileId?.trim() || null,
      enabled,
      createdBy: createdBy || null,
      nextRunAt,
    });

    await recordAudit(request, {
      action: AuditAction.SCHEDULE_CREATE,
      targetType: "schedule",
      targetId: id,
      detail: `Created schedule "${name}" (${cronExpression})`,
    });

    return reply.status(201).send({
      id,
      name,
      cronExpression,
      selector: persistedSelector,
      grafanaVersion,
      enabled,
      nextRunAt,
    });
  });

  // GET /api/schedules — list all schedules
  app.get("/schedules", async () => {
    const result = await db
      .select()
      .from(schedules)
      .orderBy(desc(schedules.createdAt));

    return { schedules: result.map(stripScheduleSecrets) };
  });

  // GET /api/schedules/:id — get schedule details
  app.get<{ Params: { id: string } }>(
    "/schedules/:id",
    async (request, reply) => {
      const result = await db
        .select()
        .from(schedules)
        .where(eq(schedules.id, request.params.id))
        .limit(1);

      if (result.length === 0) {
        return reply.notFound("Schedule not found");
      }

      return { schedule: stripScheduleSecrets(result[0]) };
    }
  );

  // PUT /api/schedules/:id — update schedule
  app.put<{
    Params: { id: string };
    Body: {
      name?: string;
      cronExpression?: string;
      selector?: string;
      grafanaVersion?: string;
      enabled?: boolean;
    };
  }>("/schedules/:id", async (request, reply) => {
    const { name, cronExpression, selector, grafanaVersion, enabled } =
      request.body || {};

    const existing = await db
      .select()
      .from(schedules)
      .where(eq(schedules.id, request.params.id))
      .limit(1);

    if (existing.length === 0) {
      return reply.notFound("Schedule not found");
    }

    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (name !== undefined) updates.name = name;
    if (cronExpression !== undefined) {
      const parts = cronExpression.trim().split(/\s+/);
      if (parts.length !== 5) {
        return reply.badRequest("Invalid cron expression");
      }
      updates.cronExpression = cronExpression;
      updates.nextRunAt = computeNextRun(cronExpression);
    }
    if (selector !== undefined) updates.selector = selector;
    if (grafanaVersion !== undefined) updates.grafanaVersion = grafanaVersion;
    if (enabled !== undefined) {
      updates.enabled = enabled;
      if (enabled) {
        const cron = (cronExpression || existing[0].cronExpression) as string;
        updates.nextRunAt = computeNextRun(cron);
      } else {
        updates.nextRunAt = null;
      }
    }

    await db
      .update(schedules)
      .set(updates)
      .where(eq(schedules.id, request.params.id));

    await recordAudit(request, {
      action: AuditAction.SCHEDULE_UPDATE,
      targetType: "schedule",
      targetId: request.params.id,
      detail: `Updated schedule "${existing[0].name}"`,
    });

    return { message: "Schedule updated", id: request.params.id };
  });

  // DELETE /api/schedules/:id — delete schedule (admin only)
  app.delete<{ Params: { id: string } }>(
    "/schedules/:id",
    { preHandler: requireAdmin },
    async (request, reply) => {
      const existing = await db
        .select()
        .from(schedules)
        .where(eq(schedules.id, request.params.id))
        .limit(1);

      if (existing.length === 0) {
        return reply.notFound("Schedule not found");
      }

      await db.delete(schedules).where(eq(schedules.id, request.params.id));

      await recordAudit(request, {
        action: AuditAction.SCHEDULE_DELETE,
        targetType: "schedule",
        targetId: request.params.id,
        detail: `Deleted schedule "${existing[0].name}"`,
      });

      return { message: "Schedule deleted", id: request.params.id };
    }
  );

  // POST /api/schedules/:id/run — trigger a scheduled run immediately
  app.post<{ Params: { id: string } }>(
    "/schedules/:id/run",
    async (request, reply) => {
      const result = await db
        .select()
        .from(schedules)
        .where(eq(schedules.id, request.params.id))
        .limit(1);

      if (result.length === 0) {
        return reply.notFound("Schedule not found");
      }

      const schedule = result[0];

      // Trigger a run via the runs API logic
      const { Queue } = await import("bullmq");
      const { Redis: IORedis } = await import("ioredis");
      const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";
      const connection = new IORedis(REDIS_URL, { maxRetriesPerRequest: null }) as any;
      const queue = new Queue("test-runs", { connection });

      const runId = randomUUID();
      const { runs } = await import("../../../db/schema");

      // Reconstruct individual test IDs (if this schedule targets specific tests).
      let testIds: string[] = [];
      if (schedule.testIds) {
        try {
          const parsed = JSON.parse(schedule.testIds);
          if (Array.isArray(parsed)) testIds = parsed.filter((t) => typeof t === "string");
        } catch {
          /* ignore malformed testIds */
        }
      }

      // Rebuild the remote target (with auth) from the stored schedule.
      // Secrets are decrypted here (#2); a referenced auth profile takes
      // precedence and can also inject a captured SSO session (#1).
      const target = schedule.targetUrl
        ? {
            url: schedule.targetUrl,
            authType: schedule.authType as "none" | "basic" | "token",
            username: schedule.authUsername ?? undefined,
            password: maybeDecrypt(schedule.authPassword) ?? undefined,
            token: maybeDecrypt(schedule.authToken) ?? undefined,
            storageState: undefined as string | undefined,
          }
        : undefined;

      if (target && schedule.authProfileId) {
        const profile = await loadResolvedProfile(schedule.authProfileId);
        if (profile) {
          if (profile.kind === "basic") {
            target.authType = "basic";
            target.username = profile.username ?? target.username;
            target.password = profile.secret ?? target.password;
          } else if (profile.kind === "token") {
            target.authType = "token";
            target.token = profile.secret ?? target.token;
          } else if (profile.kind === "storage_state") {
            target.storageState = profile.storageState ?? undefined;
          }
        }
      }

      await db.insert(runs).values({
        id: runId,
        triggerSource: "schedule",
        commitSha: "HEAD",
        grafanaVersion: schedule.grafanaVersion,
        selector: schedule.selector,
        status: "queued",
      });

      await queue.add("execute-run", {
        runId,
        selector: schedule.selector,
        testIds,
        grafanaVersion: schedule.grafanaVersion,
        commitSha: "HEAD",
        triggerSource: "schedule",
        target,
      });

      // Update last run time and compute next run
      const nextRunAt = computeNextRun(schedule.cronExpression);
      await db
        .update(schedules)
        .set({ lastRunAt: new Date(), nextRunAt, updatedAt: new Date() })
        .where(eq(schedules.id, schedule.id));

      await connection.quit();

      await recordAudit(request, {
        action: AuditAction.SCHEDULE_RUN,
        targetType: "schedule",
        targetId: schedule.id,
        detail: `Manually ran schedule "${schedule.name}" → run ${runId}`,
      });

      return reply.status(202).send({
        runId,
        scheduleId: schedule.id,
        status: "queued",
        nextRunAt,
      });
    }
  );
};
