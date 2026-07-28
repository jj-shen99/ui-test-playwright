/**
 * Role-based access control for destructive/admin actions (enhancement #17).
 *
 * The platform's auth is currently identity-by-header: the frontend asserts the
 * logged-in user via the `x-user-id` header. This module resolves that id to a
 * role *from the database* (the source of truth) and gates admin-only actions.
 * The client cannot self-declare a role — it can only claim an id, which the
 * server verifies against the users table.
 */

import { type FastifyRequest, type FastifyReply } from "fastify";
import { db } from "../../../db/connection";
import { users } from "../../../db/schema";
import { eq } from "drizzle-orm";

export const USER_ID_HEADER = "x-user-id";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Pure: does this DB role string grant admin privileges? */
export function isAdminRole(role: string | null | undefined): boolean {
  return role === "admin";
}

/** Pure: is the string a syntactically valid user id (UUID)? */
export function isValidUserId(id: string): boolean {
  return UUID_RE.test(id);
}

/** Pure: extract the asserted user id from request headers, or null. */
export function getRequestUserId(
  headers: Record<string, unknown>
): string | null {
  const raw = headers[USER_ID_HEADER];
  const val = Array.isArray(raw) ? raw[0] : raw;
  return typeof val === "string" && val.trim() ? val.trim() : null;
}

/**
 * Fastify preHandler: allow the request only when the asserted user maps to an
 * active admin in the database. Responds 401 for missing/invalid/unknown users
 * and 403 for authenticated-but-non-admin users.
 */
export async function requireAdmin(
  request: FastifyRequest,
  reply: FastifyReply
) {
  const userId = getRequestUserId(request.headers as Record<string, unknown>);
  if (!userId || !isValidUserId(userId)) {
    return reply.unauthorized("Authentication required (missing user identity)");
  }

  const rows = await db
    .select({ role: users.role, active: users.active })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  const user = rows[0];
  if (!user || !user.active) {
    return reply.unauthorized("Invalid or inactive user");
  }
  if (!isAdminRole(user.role)) {
    return reply.forbidden("Admin role required for this action");
  }
}
