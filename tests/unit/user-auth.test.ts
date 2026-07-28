/**
 * Unit tests for user registration, password reset, and role validation logic.
 */

import { describe, it, expect } from "vitest";

// ── Replicate validation logic from users.ts routes ──

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

function isValidRole(role: string): boolean {
  return ["admin", "user"].includes(role);
}

function isResetTokenExpired(expiresAt: Date | null): boolean {
  if (!expiresAt) return true;
  return expiresAt < new Date();
}

// ── Email validation ──

describe("Email validation", () => {
  it("accepts valid email", () => {
    expect(validateEmail("user@example.com")).toBe(true);
  });

  it("accepts email with subdomain", () => {
    expect(validateEmail("user@mail.example.com")).toBe(true);
  });

  it("accepts email with plus addressing", () => {
    expect(validateEmail("user+tag@example.com")).toBe(true);
  });

  it("rejects email without @", () => {
    expect(validateEmail("userexample.com")).toBe(false);
  });

  it("rejects email without domain", () => {
    expect(validateEmail("user@")).toBe(false);
  });

  it("rejects email with spaces", () => {
    expect(validateEmail("user @example.com")).toBe(false);
  });

  it("rejects empty string", () => {
    expect(validateEmail("")).toBe(false);
  });
});

// ── Password validation ──

describe("Password validation", () => {
  it("accepts valid password (8+ chars, upper, lower, number)", () => {
    expect(validatePassword("TestPass1")).toBeNull();
  });

  it("accepts strong password", () => {
    expect(validatePassword("MyStr0ngP@ss")).toBeNull();
  });

  it("rejects password shorter than 8 characters", () => {
    expect(validatePassword("Aa1")).toContain("at least 8 characters");
  });

  it("rejects exactly 7 characters", () => {
    expect(validatePassword("Abcde1f")).toContain("at least 8 characters");
  });

  it("accepts exactly 8 characters", () => {
    expect(validatePassword("Abcdef1g")).toBeNull();
  });

  it("rejects password without uppercase", () => {
    expect(validatePassword("testpass1")).toContain("uppercase");
  });

  it("rejects password without lowercase", () => {
    expect(validatePassword("TESTPASS1")).toContain("lowercase");
  });

  it("rejects password without number", () => {
    expect(validatePassword("TestPassword")).toContain("number");
  });

  it("rejects empty password", () => {
    expect(validatePassword("")).toContain("at least 8 characters");
  });
});

// ── Role validation ──

describe("Role validation", () => {
  it("accepts 'admin' role", () => {
    expect(isValidRole("admin")).toBe(true);
  });

  it("accepts 'user' role", () => {
    expect(isValidRole("user")).toBe(true);
  });

  it("rejects 'editor' role (deprecated)", () => {
    expect(isValidRole("editor")).toBe(false);
  });

  it("rejects 'viewer' role (deprecated)", () => {
    expect(isValidRole("viewer")).toBe(false);
  });

  it("rejects empty string", () => {
    expect(isValidRole("")).toBe(false);
  });

  it("rejects arbitrary string", () => {
    expect(isValidRole("superadmin")).toBe(false);
  });
});

// ── Reset token expiration ──

describe("Reset token expiration", () => {
  it("considers null expiry as expired", () => {
    expect(isResetTokenExpired(null)).toBe(true);
  });

  it("considers past date as expired", () => {
    const past = new Date(Date.now() - 60_000);
    expect(isResetTokenExpired(past)).toBe(true);
  });

  it("considers future date as not expired", () => {
    const future = new Date(Date.now() + 60 * 60 * 1000);
    expect(isResetTokenExpired(future)).toBe(false);
  });

  it("considers a date 1 hour in the future as not expired", () => {
    const oneHour = new Date(Date.now() + 3600_000);
    expect(isResetTokenExpired(oneHour)).toBe(false);
  });
});

// ── Registration form validation (frontend logic) ──

describe("Registration form validation", () => {
  function validateRegistration(form: {
    email: string;
    name: string;
    password: string;
    confirmPassword: string;
  }): string | null {
    if (!form.email || !form.name || !form.password) return "All fields are required";
    if (!validateEmail(form.email)) return "Invalid email format";
    if (form.password !== form.confirmPassword) return "Passwords do not match";
    return validatePassword(form.password);
  }

  it("passes valid registration", () => {
    expect(
      validateRegistration({
        email: "test@example.com",
        name: "Test User",
        password: "TestPass1",
        confirmPassword: "TestPass1",
      })
    ).toBeNull();
  });

  it("fails when passwords don't match", () => {
    expect(
      validateRegistration({
        email: "test@example.com",
        name: "Test User",
        password: "TestPass1",
        confirmPassword: "TestPass2",
      })
    ).toContain("do not match");
  });

  it("fails when name is empty", () => {
    expect(
      validateRegistration({
        email: "test@example.com",
        name: "",
        password: "TestPass1",
        confirmPassword: "TestPass1",
      })
    ).toContain("required");
  });

  it("fails when email is invalid", () => {
    expect(
      validateRegistration({
        email: "notanemail",
        name: "Test",
        password: "TestPass1",
        confirmPassword: "TestPass1",
      })
    ).toContain("Invalid email");
  });

  it("fails when password is weak", () => {
    expect(
      validateRegistration({
        email: "test@example.com",
        name: "Test",
        password: "weak",
        confirmPassword: "weak",
      })
    ).toContain("at least 8 characters");
  });
});
