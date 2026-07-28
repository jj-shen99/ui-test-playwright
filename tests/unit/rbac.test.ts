/**
 * Unit tests for RBAC pure helpers (enhancement #17).
 *
 * Techniques:
 * - Equivalence partitioning: admin vs non-admin roles; present vs absent header.
 * - Boundary values: empty string, whitespace-only id, malformed UUID.
 * - Decision table: header value shapes (string / array / undefined / number).
 * - Security: rejects non-UUID ids so they never reach the SQL uuid column.
 */

import { describe, it, expect } from "vitest";
import {
  isAdminRole,
  isValidUserId,
  getRequestUserId,
  requireAdmin,
  USER_ID_HEADER,
} from "../../services/api/routes/rbac";

/** Minimal Fastify reply stub capturing the guard's rejection. */
function makeReply() {
  const calls: { method: string; message: string }[] = [];
  const make = (method: string) => (message: string) => {
    calls.push({ method, message });
    return { rejected: method };
  };
  return {
    calls,
    unauthorized: make("unauthorized"),
    forbidden: make("forbidden"),
  };
}

const VALID_UUID = "11111111-2222-4333-8444-555555555555";

describe("isAdminRole", () => {
  it("returns true only for the exact 'admin' role", () => {
    expect(isAdminRole("admin")).toBe(true);
  });

  it.each(["user", "Admin", "ADMIN", "", null, undefined])(
    "returns false for non-admin role %s",
    (role) => {
      expect(isAdminRole(role as string | null | undefined)).toBe(false);
    }
  );
});

describe("isValidUserId", () => {
  it("accepts a well-formed UUID", () => {
    expect(isValidUserId(VALID_UUID)).toBe(true);
  });

  it.each([
    "",
    "   ",
    "not-a-uuid",
    "11111111-2222-4333-8444", // too short
    "'; DROP TABLE users;--",
    "11111111222243338444555555555555", // missing dashes
  ])("rejects invalid id %s", (id) => {
    expect(isValidUserId(id)).toBe(false);
  });
});

describe("getRequestUserId", () => {
  it("reads the id from the identity header", () => {
    expect(getRequestUserId({ [USER_ID_HEADER]: VALID_UUID })).toBe(VALID_UUID);
  });

  it("trims surrounding whitespace", () => {
    expect(getRequestUserId({ [USER_ID_HEADER]: `  ${VALID_UUID}  ` })).toBe(
      VALID_UUID
    );
  });

  it("uses the first value when the header is an array", () => {
    expect(getRequestUserId({ [USER_ID_HEADER]: [VALID_UUID, "other"] })).toBe(
      VALID_UUID
    );
  });

  it.each([
    [{}, "missing header"],
    [{ [USER_ID_HEADER]: "" }, "empty string"],
    [{ [USER_ID_HEADER]: "   " }, "whitespace only"],
    [{ [USER_ID_HEADER]: 12345 }, "non-string value"],
    [{ [USER_ID_HEADER]: undefined }, "undefined value"],
  ])("returns null for %s", (headers, _label) => {
    expect(getRequestUserId(headers as Record<string, unknown>)).toBeNull();
  });
});

describe("requireAdmin (pre-DB rejection paths)", () => {
  it("rejects with 401 when the identity header is missing", async () => {
    const reply = makeReply();
    const result = await requireAdmin(
      { headers: {} } as never,
      reply as never
    );
    expect(reply.calls).toEqual([
      { method: "unauthorized", message: expect.stringContaining("Authentication required") },
    ]);
    expect(result).toEqual({ rejected: "unauthorized" });
  });

  it("rejects with 401 when the id is not a valid UUID (never reaches the DB)", async () => {
    const reply = makeReply();
    // A malformed id must be rejected BEFORE any query hits the uuid column.
    await requireAdmin(
      { headers: { [USER_ID_HEADER]: "'; DROP TABLE users;--" } } as never,
      reply as never
    );
    expect(reply.calls).toHaveLength(1);
    expect(reply.calls[0].method).toBe("unauthorized");
  });

  it("rejects with 401 for an empty header value", async () => {
    const reply = makeReply();
    await requireAdmin(
      { headers: { [USER_ID_HEADER]: "   " } } as never,
      reply as never
    );
    expect(reply.calls[0].method).toBe("unauthorized");
  });
});
