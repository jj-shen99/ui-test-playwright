/**
 * Reusable named auth profiles (enhancements #2 encrypted credentials, #1 SSO
 * session injection).
 *
 * A profile is one of:
 *  - 'basic'         → username + password
 *  - 'token'         → API token
 *  - 'storage_state' → a captured Playwright storageState JSON (for SSO targets)
 *
 * All secrets (password/token/storageState) are stored ENCRYPTED at rest. The
 * list/detail endpoints never return secret material — only whether it is set.
 */

import { type FastifyPluginAsync } from "fastify";
import { db } from "../../../db/connection";
import { authProfiles, type AuthProfile } from "../../../db/schema";
import { desc, eq } from "drizzle-orm";
import { encryptOptional, maybeDecrypt } from "../../shared/crypto";
import { requireAdmin } from "./rbac";
import { recordAudit, AuditAction } from "./audit";

export const AUTH_PROFILE_KINDS = ["basic", "token", "storage_state"] as const;
export type AuthProfileKind = (typeof AUTH_PROFILE_KINDS)[number];

export interface AuthProfileInput {
  name?: string;
  kind?: string;
  targetUrl?: string;
  username?: string;
  secret?: string; // password or token, depending on kind
  storageState?: string | object; // JSON string or object (storage_state kind)
}

/** Public (secret-free) view of a profile row. */
export interface PublicAuthProfile {
  id: string;
  name: string;
  kind: string;
  targetUrl: string | null;
  username: string | null;
  hasSecret: boolean;
  hasStorageState: boolean;
  createdAt: Date | string;
  updatedAt: Date | string;
}

/** Pure: strip secret material from a row for API responses. */
export function toPublicProfile(row: AuthProfile): PublicAuthProfile {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    targetUrl: row.targetUrl ?? null,
    username: row.username ?? null,
    hasSecret: Boolean(row.secretEnc),
    hasStorageState: Boolean(row.storageStateEnc),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * Pure: validate a Playwright storageState blob. Accepts a JSON string or an
 * object; returns the canonical JSON string, or null when invalid. A valid
 * storageState has `cookies` and/or `origins` arrays.
 */
export function normalizeStorageState(
  input: string | object | undefined | null
): string | null {
  if (input == null || input === "") return null;
  let obj: unknown;
  try {
    obj = typeof input === "string" ? JSON.parse(input) : input;
  } catch {
    return null;
  }
  if (typeof obj !== "object" || obj === null) return null;
  const o = obj as Record<string, unknown>;
  const hasCookies = Array.isArray(o.cookies);
  const hasOrigins = Array.isArray(o.origins);
  if (!hasCookies && !hasOrigins) return null;
  return JSON.stringify(obj);
}

/** Pure: validate create input by kind. Returns an error string, or null if OK. */
export function validateAuthProfileInput(
  body: AuthProfileInput
): string | null {
  if (!body || typeof body !== "object") return "Request body is required";
  const name = (body.name ?? "").trim();
  if (!name) return "name is required";
  const kind = body.kind as AuthProfileKind;
  if (!AUTH_PROFILE_KINDS.includes(kind)) {
    return `kind must be one of: ${AUTH_PROFILE_KINDS.join(", ")}`;
  }
  if (kind === "basic") {
    if (!(body.username ?? "").trim()) return "username is required for basic auth";
    if (!(body.secret ?? "").trim()) return "secret (password) is required for basic auth";
  } else if (kind === "token") {
    if (!(body.secret ?? "").trim()) return "secret (token) is required for token auth";
  } else if (kind === "storage_state") {
    if (normalizeStorageState(body.storageState) === null) {
      return "storageState must be a valid Playwright storage-state JSON (with cookies/origins)";
    }
  }
  return null;
}

/**
 * Load a profile and decrypt its secrets for orchestration use. Returns null if
 * not found. Callers MUST treat the result as sensitive (never log/serialize).
 */
export async function loadResolvedProfile(id: string): Promise<{
  id: string;
  name: string;
  kind: string;
  targetUrl: string | null;
  username: string | null;
  secret: string | null;
  storageState: string | null;
} | null> {
  const rows = await db
    .select()
    .from(authProfiles)
    .where(eq(authProfiles.id, id))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    targetUrl: row.targetUrl ?? null,
    username: row.username ?? null,
    secret: maybeDecrypt(row.secretEnc),
    storageState: maybeDecrypt(row.storageStateEnc),
  };
}

export const authProfilesRoutes: FastifyPluginAsync = async (app) => {
  // GET /api/auth-profiles — list (secret-free)
  app.get("/auth-profiles", async () => {
    const rows = await db
      .select()
      .from(authProfiles)
      .orderBy(desc(authProfiles.createdAt));
    return { profiles: rows.map(toPublicProfile) };
  });

  // POST /api/auth-profiles — create (admin only); secrets encrypted at rest
  app.post<{ Body: AuthProfileInput }>(
    "/auth-profiles",
    { preHandler: requireAdmin },
    async (request, reply) => {
      const body = request.body || {};
      const error = validateAuthProfileInput(body);
      if (error) return reply.badRequest(error);

      const kind = body.kind as AuthProfileKind;
      const name = body.name!.trim();

      // Reject duplicate names with a clear message (unique constraint also guards).
      const existing = await db
        .select({ id: authProfiles.id })
        .from(authProfiles)
        .where(eq(authProfiles.name, name))
        .limit(1);
      if (existing.length > 0) {
        return reply.conflict(`An auth profile named "${name}" already exists`);
      }

      const secretEnc =
        kind === "storage_state" ? null : encryptOptional(body.secret?.trim());
      const storageStateEnc =
        kind === "storage_state"
          ? encryptOptional(normalizeStorageState(body.storageState))
          : null;

      const inserted = await db
        .insert(authProfiles)
        .values({
          name,
          kind,
          targetUrl: body.targetUrl?.trim() || null,
          username: kind === "basic" ? body.username?.trim() || null : null,
          secretEnc,
          storageStateEnc,
        })
        .returning();

      await recordAudit(request, {
        action: AuditAction.AUTH_PROFILE_CREATE,
        targetType: "auth_profile",
        targetId: inserted[0].id,
        detail: `Created ${kind} profile "${name}"`,
      });

      return reply.status(201).send({ profile: toPublicProfile(inserted[0]) });
    }
  );

  // DELETE /api/auth-profiles/:id — remove (admin only)
  app.delete<{ Params: { id: string } }>(
    "/auth-profiles/:id",
    { preHandler: requireAdmin },
    async (request, reply) => {
      const rows = await db
        .select({ id: authProfiles.id, name: authProfiles.name })
        .from(authProfiles)
        .where(eq(authProfiles.id, request.params.id))
        .limit(1);
      if (rows.length === 0) return reply.notFound("Auth profile not found");

      await db.delete(authProfiles).where(eq(authProfiles.id, request.params.id));

      await recordAudit(request, {
        action: AuditAction.AUTH_PROFILE_DELETE,
        targetType: "auth_profile",
        targetId: request.params.id,
        detail: `Deleted profile "${rows[0].name}"`,
      });

      return { message: "Auth profile deleted", id: request.params.id };
    }
  );
};
