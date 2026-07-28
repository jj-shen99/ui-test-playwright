/**
 * Unit tests for target preflight pure helpers (enhancement #4):
 * toOrigin and buildAuthHeader.
 *
 * Techniques:
 * - Equivalence partitioning: none / basic / token auth.
 * - Boundary values: missing password, empty username/token, port in origin.
 * - Decision table: (authType) × (creds present) → header presence.
 * - Security: non-http(s) schemes rejected; basic header is correct base64.
 */

import { describe, it, expect } from "vitest";
import { toOrigin, buildAuthHeader } from "../../services/api/routes/targets";

describe("toOrigin", () => {
  it("reduces a deep link to its origin", () => {
    expect(toOrigin("https://g.example.com/d/abc?orgId=1")).toBe(
      "https://g.example.com"
    );
  });

  it("preserves a non-default port", () => {
    expect(toOrigin("http://localhost:3000/login")).toBe("http://localhost:3000");
  });

  it("trims whitespace", () => {
    expect(toOrigin("  https://g.example.com  ")).toBe("https://g.example.com");
  });

  it.each(["", "not a url", "javascript:alert(1)", "file:///x", "ftp://h"])(
    "returns null for invalid/non-http input %s",
    (bad) => {
      expect(toOrigin(bad)).toBeNull();
    }
  );
});

describe("buildAuthHeader", () => {
  it("returns no header for 'none'", () => {
    expect(buildAuthHeader({ authType: "none" })).toEqual({});
  });

  it("builds a correct Basic header from username:password", () => {
    const header = buildAuthHeader({
      authType: "basic",
      authUsername: "admin",
      authPassword: "s3cret",
    });
    expect(header).toEqual({
      Authorization: `Basic ${Buffer.from("admin:s3cret").toString("base64")}`,
    });
  });

  it("builds a Basic header with an empty password when none is given", () => {
    const header = buildAuthHeader({ authType: "basic", authUsername: "admin" });
    expect(header).toEqual({
      Authorization: `Basic ${Buffer.from("admin:").toString("base64")}`,
    });
  });

  it("omits Basic header when username is missing", () => {
    expect(buildAuthHeader({ authType: "basic", authPassword: "x" })).toEqual({});
  });

  it("builds a Bearer header for token auth", () => {
    expect(
      buildAuthHeader({ authType: "token", authToken: "glsa_abc" })
    ).toEqual({ Authorization: "Bearer glsa_abc" });
  });

  it("omits Bearer header when token is empty", () => {
    expect(buildAuthHeader({ authType: "token", authToken: "" })).toEqual({});
  });

  it("returns no header for an unknown auth type", () => {
    expect(buildAuthHeader({ authType: "weird", authToken: "x" })).toEqual({});
  });
});
