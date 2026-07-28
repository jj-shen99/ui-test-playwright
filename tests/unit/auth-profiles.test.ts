/**
 * Unit tests for auth-profile pure helpers (#1 SSO, #2 encrypted credentials):
 * validateAuthProfileInput, normalizeStorageState, toPublicProfile.
 *
 * Techniques: decision table (kind × required fields), equivalence
 * partitioning, boundary/edge cases, and secret-leakage safety checks.
 */

import { describe, it, expect } from "vitest";
import {
  validateAuthProfileInput,
  normalizeStorageState,
  toPublicProfile,
  AUTH_PROFILE_KINDS,
} from "../../services/api/routes/auth-profiles";
import type { AuthProfile } from "../../db/schema";

describe("normalizeStorageState", () => {
  it("returns null for nullish/empty", () => {
    expect(normalizeStorageState(null)).toBeNull();
    expect(normalizeStorageState(undefined)).toBeNull();
    expect(normalizeStorageState("")).toBeNull();
  });

  it("accepts an object with cookies array", () => {
    const out = normalizeStorageState({ cookies: [{ name: "s" }] });
    expect(out).toBe(JSON.stringify({ cookies: [{ name: "s" }] }));
  });

  it("accepts a JSON string with origins array", () => {
    const out = normalizeStorageState('{"origins":[{"origin":"https://x"}]}');
    expect(out).toBe(JSON.stringify({ origins: [{ origin: "https://x" }] }));
  });

  it("rejects invalid JSON", () => {
    expect(normalizeStorageState("{not json")).toBeNull();
  });

  it("rejects objects lacking cookies and origins", () => {
    expect(normalizeStorageState({ foo: "bar" })).toBeNull();
  });

  it("rejects non-object JSON (array/number)", () => {
    expect(normalizeStorageState("42")).toBeNull();
    expect(normalizeStorageState("[]")).toBeNull();
  });
});

describe("validateAuthProfileInput", () => {
  it("requires a body object", () => {
    // @ts-expect-error deliberate misuse
    expect(validateAuthProfileInput(null)).toMatch(/body is required/);
  });

  it("requires a name", () => {
    expect(validateAuthProfileInput({ name: "  ", kind: "token", secret: "x" })).toMatch(
      /name is required/
    );
  });

  it("rejects an unknown kind", () => {
    expect(validateAuthProfileInput({ name: "n", kind: "bogus" })).toMatch(/kind must be/);
  });

  it("accepts every declared kind list value in the message", () => {
    const msg = validateAuthProfileInput({ name: "n", kind: "bogus" })!;
    for (const k of AUTH_PROFILE_KINDS) expect(msg).toContain(k);
  });

  // ── basic ──
  it("basic requires username and secret", () => {
    expect(validateAuthProfileInput({ name: "n", kind: "basic", secret: "p" })).toMatch(
      /username is required/
    );
    expect(validateAuthProfileInput({ name: "n", kind: "basic", username: "u" })).toMatch(
      /password.*is required/
    );
    expect(
      validateAuthProfileInput({ name: "n", kind: "basic", username: "u", secret: "p" })
    ).toBeNull();
  });

  // ── token ──
  it("token requires a secret", () => {
    expect(validateAuthProfileInput({ name: "n", kind: "token" })).toMatch(/token.*is required/);
    expect(validateAuthProfileInput({ name: "n", kind: "token", secret: "t" })).toBeNull();
  });

  // ── storage_state ──
  it("storage_state requires a valid storageState", () => {
    expect(validateAuthProfileInput({ name: "n", kind: "storage_state" })).toMatch(
      /storageState must be/
    );
    expect(
      validateAuthProfileInput({
        name: "n",
        kind: "storage_state",
        storageState: { cookies: [] },
      })
    ).toBeNull();
  });
});

describe("toPublicProfile: never leaks secret material", () => {
  const base: AuthProfile = {
    id: "id-1",
    name: "prod",
    kind: "basic",
    targetUrl: "https://g",
    username: "admin",
    secretEnc: "enc:v1:xxxx",
    storageStateEnc: null,
    createdBy: null,
    createdAt: new Date("2025-01-01"),
    updatedAt: new Date("2025-01-02"),
  } as AuthProfile;

  it("exposes only booleans for secret presence", () => {
    const pub = toPublicProfile(base);
    expect(pub.hasSecret).toBe(true);
    expect(pub.hasStorageState).toBe(false);
    expect(JSON.stringify(pub)).not.toContain("enc:v1:");
    expect(pub).not.toHaveProperty("secretEnc");
    expect(pub).not.toHaveProperty("storageStateEnc");
  });

  it("reports hasStorageState true when set", () => {
    const pub = toPublicProfile({ ...base, secretEnc: null, storageStateEnc: "enc:v1:y" } as AuthProfile);
    expect(pub.hasSecret).toBe(false);
    expect(pub.hasStorageState).toBe(true);
  });

  it("normalizes missing optional fields to null", () => {
    const pub = toPublicProfile({ ...base, targetUrl: null, username: null } as AuthProfile);
    expect(pub.targetUrl).toBeNull();
    expect(pub.username).toBeNull();
  });
});
