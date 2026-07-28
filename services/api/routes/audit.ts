/**
 * Audit log (enhancement #19): record who performed sensitive actions
 * (triggers, deletes, admin changes) and expose them to admins.
 */

import { type FastifyPluginAsync, type FastifyRequest } from "fastify";
import { db } from "../../../db/connection";
import { auditLog, users } from "../../../db/schema";
import { desc, eq } from "drizzle-orm";
import { getRequestUserId, isValidUserId, requireAdmin } from "./rbac";

/** Canonical action strings, kept together so the set is easy to audit/extend. */
export const AuditAction = {
  RUN_TRIGGER: "run.trigger",
  RUN_DELETE: "run.delete",
  SCHEDULE_CREATE: "schedule.create",
  SCHEDULE_UPDATE: "schedule.update",
  SCHEDULE_DELETE: "schedule.delete",
  SCHEDULE_RUN: "schedule.run",
  TEST_DELETE: "test.delete",
  TEST_UPDATE: "test.update",
  USER_CREATE: "user.create",
  USER_UPDATE: "user.update",
  USER_DELETE: "user.delete",
  AUTH_PROFILE_CREATE: "auth_profile.create",
  AUTH_PROFILE_DELETE: "auth_profile.delete",
} as const;

export type AuditActionValue = (typeof AuditAction)[keyof typeof AuditAction];

export interface AuditEventInput {
  action: AuditActionValue | string;
  targetType?: string | null;
  targetId?: string | null;
  detail?: string | null;
}

/**
 * Best-effort audit write. Resolves the actor from the identity header (and
 * looks up their email for display). NEVER throws — auditing must not break the
 * primary action — failures are logged and swallowed.
 */
export async function recordAudit(
  request: FastifyRequest,
  event: AuditEventInput
): Promise<void> {
  try {
    const rawId = getRequestUserId(request.headers as Record<string, unknown>);
    const actorId = rawId && isValidUserId(rawId) ? rawId : null;

    let actorEmail: string | null = null;
    if (actorId) {
      const rows = await db
        .select({ email: users.email })
        .from(users)
        .where(eq(users.id, actorId))
        .limit(1);
      actorEmail = rows[0]?.email ?? null;
    }

    await db.insert(auditLog).values({
      actorId,
      actorEmail,
      action: event.action,
      targetType: event.targetType ?? null,
      targetId: event.targetId ?? null,
      detail: event.detail ?? null,
    });
  } catch (err) {
    console.error("[audit] failed to record event", event.action, err);
  }
}

export const auditRoutes: FastifyPluginAsync = async (app) => {
  // GET /api/audit — recent audit entries (admin only)
  app.get<{ Querystring: { limit?: string } }>(
    "/audit",
    { preHandler: requireAdmin },
    async (request) => {
      const limit = Math.min(Math.max(Number(request.query.limit) || 100, 1), 500);
      const entries = await db
        .select()
        .from(auditLog)
        .orderBy(desc(auditLog.createdAt))
        .limit(limit);
      return { entries };
    }
  );
};
