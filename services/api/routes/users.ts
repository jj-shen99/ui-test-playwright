/**
 * Users API routes — user management.
 * POST   /api/users/register       → self-registration (role: user)
 * POST   /api/users/login           → authenticate
 * POST   /api/users/reset-password  → reset password by email
 * POST   /api/users                 → admin create user
 * GET    /api/users                 → list users
 * GET    /api/users/:id             → get user
 * PUT    /api/users/:id             → update user
 * DELETE /api/users/:id             → deactivate user
 */

import { type FastifyPluginAsync } from "fastify";
import { db } from "../../../db/connection";
import { users } from "../../../db/schema";
import { eq, desc, sql } from "drizzle-orm";
import { randomUUID, createHash, randomBytes } from "crypto";
import { requireAdmin } from "./rbac";
import { recordAudit, AuditAction } from "./audit";

function hashPassword(password: string): string {
  return createHash("sha256").update(password).digest("hex");
}

function generateResetToken(): string {
  return randomBytes(32).toString("hex");
}

function validateEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function validatePassword(password: string): string | null {
  if (password.length < 8) return "Password must be at least 8 characters";
  if (!/[A-Z]/.test(password)) return "Password must contain at least one uppercase letter";
  if (!/[a-z]/.test(password)) return "Password must contain at least one lowercase letter";
  if (!/[0-9]/.test(password)) return "Password must contain at least one number";
  return null;
}

export const usersRoutes: FastifyPluginAsync = async (app) => {
  // POST /api/users/register — self-registration (always role: user)
  app.post<{
    Body: { email: string; name: string; password: string };
  }>("/users/register", async (request, reply) => {
    const { email: rawEmail, name: rawName, password } = request.body || {};
    const email = rawEmail?.trim();
    const name = rawName?.trim();

    if (!email || !name || !password) {
      return reply.badRequest("email, name, and password are required");
    }

    if (!validateEmail(email)) {
      return reply.badRequest("Invalid email format");
    }

    const pwError = validatePassword(password);
    if (pwError) {
      return reply.badRequest(pwError);
    }

    const existing = await db
      .select()
      .from(users)
      .where(eq(users.email, email))
      .limit(1);

    if (existing.length > 0) {
      return reply.conflict("A user with this email already exists");
    }

    const id = randomUUID();
    const passwordHash = hashPassword(password);

    await db.insert(users).values({
      id,
      email,
      name,
      role: "user",
      passwordHash,
    });

    return reply.status(201).send({
      id,
      email,
      name,
      role: "user",
      active: true,
      message: "Registration successful",
    });
  });

  // POST /api/users/reset-password — reset password by email
  app.post<{
    Body: { email: string; newPassword: string };
  }>("/users/reset-password", async (request, reply) => {
    const { email: rawEmail, newPassword } = request.body || {};
    const email = rawEmail?.trim();

    if (!email || !newPassword) {
      return reply.badRequest("email and newPassword are required");
    }

    const pwError = validatePassword(newPassword);
    if (pwError) {
      return reply.badRequest(pwError);
    }

    const result = await db
      .select()
      .from(users)
      .where(eq(users.email, email))
      .limit(1);

    if (result.length === 0) {
      return reply.badRequest("No account found with that email");
    }

    const user = result[0];

    await db
      .update(users)
      .set({
        passwordHash: hashPassword(newPassword),
        updatedAt: new Date(),
      })
      .where(eq(users.id, user.id));

    return { message: "Password has been reset successfully" };
  });

  // POST /api/users — admin create user (can set role) (admin only)
  app.post<{
    Body: {
      email: string;
      name: string;
      password: string;
      role?: string;
    };
  }>("/users", { preHandler: requireAdmin }, async (request, reply) => {
    const { email: rawEmail, name: rawName, password, role = "user" } = request.body || {};
    const email = rawEmail?.trim();
    const name = rawName?.trim();

    if (!email || !name || !password) {
      return reply.badRequest("email, name, and password are required");
    }

    if (!validateEmail(email)) {
      return reply.badRequest("Invalid email format");
    }

    if (!["admin", "user"].includes(role)) {
      return reply.badRequest("role must be admin or user");
    }

    const existing = await db
      .select()
      .from(users)
      .where(eq(users.email, email))
      .limit(1);

    if (existing.length > 0) {
      return reply.conflict("A user with this email already exists");
    }

    const id = randomUUID();
    const passwordHash = hashPassword(password);

    await db.insert(users).values({
      id,
      email,
      name,
      role,
      passwordHash,
    });

    await recordAudit(request, {
      action: AuditAction.USER_CREATE,
      targetType: "user",
      targetId: id,
      detail: `Created ${role} account ${email}`,
    });

    return reply.status(201).send({
      id,
      email,
      name,
      role,
      active: true,
    });
  });

  // GET /api/users — list all users
  app.get("/users", async () => {
    const result = await db
      .select({
        id: users.id,
        email: users.email,
        name: users.name,
        role: users.role,
        active: users.active,
        lastLoginAt: users.lastLoginAt,
        createdAt: users.createdAt,
      })
      .from(users)
      .orderBy(desc(users.createdAt));

    return { users: result };
  });

  // GET /api/users/:id — get a single user
  app.get<{ Params: { id: string } }>("/users/:id", async (request, reply) => {
    const result = await db
      .select({
        id: users.id,
        email: users.email,
        name: users.name,
        role: users.role,
        active: users.active,
        lastLoginAt: users.lastLoginAt,
        createdAt: users.createdAt,
        updatedAt: users.updatedAt,
      })
      .from(users)
      .where(eq(users.id, request.params.id))
      .limit(1);

    if (result.length === 0) {
      return reply.notFound("User not found");
    }

    return { user: result[0] };
  });

  // PUT /api/users/:id — update user (admin only)
  app.put<{
    Params: { id: string };
    Body: {
      name?: string;
      role?: string;
      active?: boolean;
      password?: string;
    };
  }>("/users/:id", { preHandler: requireAdmin }, async (request, reply) => {
    const { name, role, active, password } = request.body || {};

    if (role && !["admin", "user"].includes(role)) {
      return reply.badRequest("role must be admin or user");
    }

    const existing = await db
      .select()
      .from(users)
      .where(eq(users.id, request.params.id))
      .limit(1);

    if (existing.length === 0) {
      return reply.notFound("User not found");
    }

    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (name !== undefined) updates.name = name;
    if (role !== undefined) updates.role = role;
    if (active !== undefined) updates.active = active;
    if (password) updates.passwordHash = hashPassword(password);

    await db.update(users).set(updates).where(eq(users.id, request.params.id));

    const changed = Object.keys(updates).filter((k) => k !== "updatedAt");
    await recordAudit(request, {
      action: AuditAction.USER_UPDATE,
      targetType: "user",
      targetId: request.params.id,
      detail: `Updated ${existing[0].email} (${changed.join(", ") || "no fields"})`,
    });

    return { message: "User updated", id: request.params.id };
  });

  // DELETE /api/users/:id — deactivate user (soft delete) (admin only)
  app.delete<{ Params: { id: string } }>(
    "/users/:id",
    { preHandler: requireAdmin },
    async (request, reply) => {
      const existing = await db
        .select()
        .from(users)
        .where(eq(users.id, request.params.id))
        .limit(1);

      if (existing.length === 0) {
        return reply.notFound("User not found");
      }

      await db
        .update(users)
        .set({ active: false, updatedAt: new Date() })
        .where(eq(users.id, request.params.id));

      await recordAudit(request, {
        action: AuditAction.USER_DELETE,
        targetType: "user",
        targetId: request.params.id,
        detail: `Deactivated account ${existing[0].email}`,
      });

      return { message: "User deactivated", id: request.params.id };
    }
  );

  // POST /api/users/login — authenticate user
  app.post<{
    Body: { email: string; password: string };
  }>("/users/login", async (request, reply) => {
    const { email, password } = request.body || {};

    if (!email || !password) {
      return reply.badRequest("email and password are required");
    }

    const result = await db
      .select()
      .from(users)
      .where(eq(users.email, email))
      .limit(1);

    if (result.length === 0) {
      return reply.unauthorized("Invalid credentials");
    }

    const user = result[0];

    if (!user.active) {
      return reply.forbidden("Account is deactivated");
    }

    if (hashPassword(password) !== user.passwordHash) {
      return reply.unauthorized("Invalid credentials");
    }

    // Update last login
    await db
      .update(users)
      .set({ lastLoginAt: new Date() })
      .where(eq(users.id, user.id));

    return {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
      },
      message: "Login successful",
    };
  });
};
