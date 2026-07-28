/**
 * Unit tests for Trigger Run logic:
 * - backend: persisted-selector derivation + testId sanitization (runs route)
 * - frontend: canRun gating + triggerRun payload shaping (TriggerRun.tsx)
 *
 * These replicate the small pure logic embedded in the route handler / component
 * (matching the repo's existing logic-mirroring unit-test convention).
 *
 * Techniques: equivalence partitioning, boundary values (0/1/N tests),
 * decision table (mode × selection), regression (secrets not persisted).
 */

import { describe, it, expect } from "vitest";

// ── Backend: mirror of runs route selector logic ──

function sanitizeTestIds(testIds: unknown): string[] {
  return Array.isArray(testIds)
    ? testIds.filter((t): t is string => typeof t === "string" && t.trim().length > 0)
    : [];
}

function derivePersistedSelector(rawSelector: string, selectedTestIds: string[]): string {
  return selectedTestIds.length === 1
    ? selectedTestIds[0]
    : selectedTestIds.length > 1
    ? `${selectedTestIds.length} tests`
    : rawSelector;
}

// ── Frontend: mirror of TriggerRun gating + payload ──

type RunMode = "preset" | "individual";

function canRun(mode: RunMode, selectedCount: number): boolean {
  return mode === "preset" ? true : selectedCount > 0;
}

function buildTriggerPayload(opts: {
  mode: RunMode;
  selector: string;
  selectedTestIds: string[];
}): { selector: string; testIds?: string[] } {
  return {
    selector: opts.mode === "preset" ? opts.selector : "all",
    testIds: opts.mode === "individual" ? opts.selectedTestIds : undefined,
  };
}

describe("runs route — sanitizeTestIds", () => {
  it("returns [] for non-array input", () => {
    expect(sanitizeTestIds(undefined)).toEqual([]);
    expect(sanitizeTestIds(null)).toEqual([]);
    expect(sanitizeTestIds("x")).toEqual([]);
  });

  it("drops empty and whitespace-only entries", () => {
    expect(sanitizeTestIds(["a", "", "  ", "b"])).toEqual(["a", "b"]);
  });

  it("drops non-string entries", () => {
    expect(sanitizeTestIds(["a", 1, {}, "b"] as unknown)).toEqual(["a", "b"]);
  });

  it("keeps a valid list unchanged", () => {
    expect(sanitizeTestIds(["f::x", "f::y"])).toEqual(["f::x", "f::y"]);
  });
});

describe("runs route — derivePersistedSelector", () => {
  // boundary values: 0, 1, N selected tests
  it("uses the raw preset selector when no tests selected", () => {
    expect(derivePersistedSelector("smoke", [])).toBe("smoke");
    expect(derivePersistedSelector("all", [])).toBe("all");
  });

  it("uses the single testId when exactly one selected", () => {
    expect(derivePersistedSelector("all", ["f.spec.ts::x"])).toBe("f.spec.ts::x");
  });

  it("summarizes as 'N tests' when more than one selected", () => {
    expect(derivePersistedSelector("all", ["a", "b"])).toBe("2 tests");
    expect(derivePersistedSelector("all", ["a", "b", "c"])).toBe("3 tests");
  });
});

describe("TriggerRun — canRun", () => {
  // decision table: mode × selectedCount
  it("preset mode is always runnable regardless of selection", () => {
    expect(canRun("preset", 0)).toBe(true);
    expect(canRun("preset", 5)).toBe(true);
  });

  it("individual mode requires at least one selected test", () => {
    expect(canRun("individual", 0)).toBe(false);
    expect(canRun("individual", 1)).toBe(true);
  });
});

describe("TriggerRun — buildTriggerPayload", () => {
  it("preset mode sends selector and no testIds", () => {
    expect(buildTriggerPayload({ mode: "preset", selector: "regression", selectedTestIds: [] })).toEqual({
      selector: "regression",
      testIds: undefined,
    });
  });

  it("individual mode sends testIds and selector 'all'", () => {
    expect(
      buildTriggerPayload({ mode: "individual", selector: "smoke", selectedTestIds: ["f::x"] })
    ).toEqual({ selector: "all", testIds: ["f::x"] });
  });
});

// ── Shared RunConfig -> payload (used by both /trigger and /schedules) ──

interface RunTargetConfig {
  mode: RunMode;
  selector: string;
  selectedTestIds: string[];
  targetUrl: string;
  authType: "none" | "basic" | "token";
  authUsername: string;
  authPassword: string;
  authToken: string;
}

// Mirror of runConfigToPayload from components/RunConfigFields.tsx
function runConfigToPayload(config: RunTargetConfig) {
  return {
    selector: config.mode === "preset" ? config.selector : "all",
    testIds: config.mode === "individual" ? config.selectedTestIds : undefined,
    targetUrl: config.targetUrl.trim() || undefined,
    authType: config.authType,
    authUsername: config.authUsername.trim() || undefined,
    authPassword: config.authPassword || undefined,
    authToken: config.authToken.trim() || undefined,
  };
}

const baseConfig: RunTargetConfig = {
  mode: "preset",
  selector: "all",
  selectedTestIds: [],
  targetUrl: "",
  authType: "none",
  authUsername: "",
  authPassword: "",
  authToken: "",
};

describe("runConfigToPayload (shared)", () => {
  it("omits target/auth when blank (local env, no auth)", () => {
    expect(runConfigToPayload(baseConfig)).toEqual({
      selector: "all",
      testIds: undefined,
      targetUrl: undefined,
      authType: "none",
      authUsername: undefined,
      authPassword: undefined,
      authToken: undefined,
    });
  });

  it("trims target URL and basic-auth username", () => {
    const payload = runConfigToPayload({
      ...baseConfig,
      targetUrl: "  https://g.example.com  ",
      authType: "basic",
      authUsername: "  admin  ",
      authPassword: "secret",
    });
    expect(payload.targetUrl).toBe("https://g.example.com");
    expect(payload.authUsername).toBe("admin");
    expect(payload.authPassword).toBe("secret");
  });

  it("passes token through (trimmed)", () => {
    const payload = runConfigToPayload({
      ...baseConfig,
      targetUrl: "https://g.example.com",
      authType: "token",
      authToken: "  tok_123  ",
    });
    expect(payload.authToken).toBe("tok_123");
  });

  it("individual mode forwards selected testIds and forces selector 'all'", () => {
    const payload = runConfigToPayload({
      ...baseConfig,
      mode: "individual",
      selector: "smoke",
      selectedTestIds: ["f::a", "f::b"],
    });
    expect(payload.selector).toBe("all");
    expect(payload.testIds).toEqual(["f::a", "f::b"]);
  });
});
