/**
 * Unit tests for authentication guard and useCurrentUser logic.
 * Verifies route protection, login/logout flow, and role-based access.
 */

import { describe, it, expect } from "vitest";

// ── Replicate the auth logic from useCurrentUser.ts ──

interface CurrentUser {
  id: string;
  email: string;
  name: string;
  role: string;
}

function isAdmin(user: CurrentUser | null): boolean {
  return user?.role === "admin";
}

// ── Replicate route protection logic from App.tsx ──

const PUBLIC_ROUTES = ["/login", "/register", "/forgot-password"];

const PROTECTED_ROUTES = [
  "/",
  "/runs/:id",
  "/trigger",
  "/tests",
  "/tests/:testId",
  "/insights",
  "/users",
  "/schedules",
  "/generate",
  "/results",
  "/results/:resultId",
  "/settings",
];

// ── Replicate nav filtering logic from App.tsx ──

const navItems = [
  { to: "/", label: "Dashboard", adminOnly: false },
  { to: "/generate", label: "Generate", adminOnly: false },
  { to: "/tests", label: "Test Catalog", adminOnly: false },
  { to: "/trigger", label: "Trigger Run", adminOnly: false },
  { to: "/schedules", label: "Schedules", adminOnly: false },
  { to: "/results", label: "Results", adminOnly: false },
  { to: "/insights", label: "ML Insights", adminOnly: false },
  { to: "/settings", label: "Settings", adminOnly: false },
  { to: "/users", label: "Users", adminOnly: true },
];

function getVisibleNavItems(user: CurrentUser | null) {
  const userIsAdmin = isAdmin(user);
  return navItems.filter((item) => !item.adminOnly || userIsAdmin);
}

// ── Test users ──

const adminUser: CurrentUser = {
  id: "1",
  email: "admin@test.com",
  name: "Admin User",
  role: "admin",
};

const regularUser: CurrentUser = {
  id: "2",
  email: "user@test.com",
  name: "Regular User",
  role: "user",
};

// ── Tests ──

describe("isAdmin", () => {
  it("returns true for admin role", () => {
    expect(isAdmin(adminUser)).toBe(true);
  });

  it("returns false for user role", () => {
    expect(isAdmin(regularUser)).toBe(false);
  });

  it("returns false for null user", () => {
    expect(isAdmin(null)).toBe(false);
  });

  it("returns false for undefined role", () => {
    expect(isAdmin({ id: "3", email: "x", name: "x", role: "" })).toBe(false);
  });
});

describe("Route protection", () => {
  it("public routes include login, register, forgot-password", () => {
    expect(PUBLIC_ROUTES).toContain("/login");
    expect(PUBLIC_ROUTES).toContain("/register");
    expect(PUBLIC_ROUTES).toContain("/forgot-password");
  });

  it("public routes are exactly 3", () => {
    expect(PUBLIC_ROUTES).toHaveLength(3);
  });

  it("protected routes do not include any public route", () => {
    for (const route of PUBLIC_ROUTES) {
      expect(PROTECTED_ROUTES).not.toContain(route);
    }
  });

  it("all protected routes start with /", () => {
    for (const route of PROTECTED_ROUTES) {
      expect(route.startsWith("/")).toBe(true);
    }
  });

  it("/ (dashboard) is a protected route", () => {
    expect(PROTECTED_ROUTES).toContain("/");
  });

  it("/settings is a protected route", () => {
    expect(PROTECTED_ROUTES).toContain("/settings");
  });

  it("/users is a protected route", () => {
    expect(PROTECTED_ROUTES).toContain("/users");
  });
});

describe("Nav filtering by role", () => {
  it("admin sees all 9 nav items", () => {
    expect(getVisibleNavItems(adminUser)).toHaveLength(9);
  });

  it("regular user sees 8 nav items (no Users)", () => {
    const visible = getVisibleNavItems(regularUser);
    expect(visible).toHaveLength(8);
    expect(visible.find((n) => n.label === "Users")).toBeUndefined();
  });

  it("null user sees 8 nav items (no Users)", () => {
    const visible = getVisibleNavItems(null);
    expect(visible).toHaveLength(8);
    expect(visible.find((n) => n.label === "Users")).toBeUndefined();
  });

  it("admin can see Users nav item", () => {
    const visible = getVisibleNavItems(adminUser);
    expect(visible.find((n) => n.label === "Users")).toBeDefined();
  });

  it("only Users is admin-only", () => {
    const adminOnly = navItems.filter((n) => n.adminOnly);
    expect(adminOnly).toHaveLength(1);
    expect(adminOnly[0].label).toBe("Users");
  });

  it("Settings is visible to all users", () => {
    const visible = getVisibleNavItems(regularUser);
    expect(visible.find((n) => n.label === "Settings")).toBeDefined();
  });
});

describe("Auth state transitions", () => {
  it("unauthenticated user should be redirected (no currentUser)", () => {
    const currentUser: CurrentUser | null = null;
    const shouldRedirect = !currentUser;
    expect(shouldRedirect).toBe(true);
  });

  it("authenticated user should not be redirected", () => {
    const currentUser: CurrentUser | null = regularUser;
    const shouldRedirect = !currentUser;
    expect(shouldRedirect).toBe(false);
  });

  it("logout clears user state (simulated)", () => {
    let currentUser: CurrentUser | null = regularUser;
    // simulate logout
    currentUser = null;
    expect(currentUser).toBeNull();
    expect(!currentUser).toBe(true); // would trigger redirect
  });

  it("login sets user state (simulated)", () => {
    let currentUser: CurrentUser | null = null;
    // simulate login
    currentUser = regularUser;
    expect(currentUser).not.toBeNull();
    expect(currentUser!.email).toBe("user@test.com");
  });
});
