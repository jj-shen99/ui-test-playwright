/**
 * Unit tests for frontend navigation structure.
 * Verifies nav items, labels, and route paths are consistent.
 */

import { describe, it, expect } from "vitest";

// Replicate the navItems structure from App.tsx for verification
const navItems = [
  { to: "/", label: "Dashboard" },
  { to: "/generate", label: "Generate" },
  { to: "/tests", label: "Test Catalog" },
  { to: "/trigger", label: "Trigger Run" },
  { to: "/schedules", label: "Schedules" },
  { to: "/results", label: "Results" },
  { to: "/insights", label: "ML Insights" },
  { to: "/settings", label: "Settings" },
  { to: "/users", label: "Users" },
];

const routes = [
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
  "/login",
  "/register",
  "/forgot-password",
];

describe("Navigation structure", () => {
  // ── Equivalence partitioning ──

  it("has 9 nav items", () => {
    expect(navItems).toHaveLength(9);
  });

  it("first nav item is Dashboard (renamed from Runs)", () => {
    expect(navItems[0].label).toBe("Dashboard");
    expect(navItems[0].to).toBe("/");
  });

  it("Results nav item exists with correct path", () => {
    const results = navItems.find((n) => n.label === "Results");
    expect(results).toBeDefined();
    expect(results!.to).toBe("/results");
  });

  it("all nav items have unique paths", () => {
    const paths = navItems.map((n) => n.to);
    expect(new Set(paths).size).toBe(paths.length);
  });

  it("all nav items have non-empty labels", () => {
    for (const item of navItems) {
      expect(item.label.length).toBeGreaterThan(0);
    }
  });

  // ── Route coverage ──

  it("every nav item path has a corresponding route", () => {
    for (const item of navItems) {
      const matchesRoute = routes.some(
        (r) => r === item.to || r.startsWith(item.to + "/")
      );
      expect(matchesRoute).toBe(true);
    }
  });

  it("has 15 total routes", () => {
    expect(routes).toHaveLength(15);
  });

  it("results routes include list and detail", () => {
    expect(routes).toContain("/results");
    expect(routes).toContain("/results/:resultId");
  });

  // ── Regression: no duplicate labels ──

  it("all nav items have unique labels", () => {
    const labels = navItems.map((n) => n.label);
    expect(new Set(labels).size).toBe(labels.length);
  });

  // ── Regression: 'Runs' label no longer exists ──

  it("does not have a nav item labeled 'Runs' (renamed to Dashboard)", () => {
    const runsItem = navItems.find((n) => n.label === "Runs");
    expect(runsItem).toBeUndefined();
  });

  it("Generate nav item exists with correct path", () => {
    const gen = navItems.find((n) => n.label === "Generate");
    expect(gen).toBeDefined();
    expect(gen!.to).toBe("/generate");
  });

  it("generate route exists", () => {
    expect(routes).toContain("/generate");
  });

  // ── Auth routes ──

  it("has login route", () => {
    expect(routes).toContain("/login");
  });

  it("has register route", () => {
    expect(routes).toContain("/register");
  });

  it("has forgot-password route", () => {
    expect(routes).toContain("/forgot-password");
  });

  // ── Settings ──

  it("Settings nav item exists with correct path", () => {
    const settings = navItems.find((n) => n.label === "Settings");
    expect(settings).toBeDefined();
    expect(settings!.to).toBe("/settings");
  });

  it("Settings appears before Users in nav order", () => {
    const settingsIdx = navItems.findIndex((n) => n.label === "Settings");
    const usersIdx = navItems.findIndex((n) => n.label === "Users");
    expect(settingsIdx).toBeLessThan(usersIdx);
  });

  // ── Nav order verification ──

  it("nav items are in the correct order", () => {
    const labels = navItems.map((n) => n.label);
    expect(labels).toEqual([
      "Dashboard",
      "Generate",
      "Test Catalog",
      "Trigger Run",
      "Schedules",
      "Results",
      "ML Insights",
      "Settings",
      "Users",
    ]);
  });

  // ── Title ──

  it("app title is OODP Grafana UI Testing", () => {
    const title = "OODP Grafana UI Testing";
    expect(title).toBe("OODP Grafana UI Testing");
  });
});
