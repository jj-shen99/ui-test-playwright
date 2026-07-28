/**
 * Unit tests for Results view filtering/stats logic.
 * Tests the pure logic portions without React rendering.
 */

import { describe, it, expect } from "vitest";

// Replicate the filtering and stats logic from Results.tsx
interface TestResult {
  id: string;
  testId: string;
  status: string;
  durationMs: number | null;
  retryCount: number;
  failureSignature: string | null;
}

function filterResults(
  results: TestResult[],
  statusFilter: string,
  search: string
): TestResult[] {
  return results.filter((r) => {
    if (statusFilter !== "all" && r.status !== statusFilter) return false;
    if (search && !r.testId.toLowerCase().includes(search.toLowerCase()))
      return false;
    return true;
  });
}

function computeStats(results: TestResult[]) {
  return {
    total: results.length,
    passed: results.filter((r) => r.status === "passed").length,
    failed: results.filter((r) => r.status === "failed").length,
    skipped: results.filter((r) => r.status === "skipped").length,
    flaky: results.filter((r) => r.status === "flaky").length,
  };
}

const SAMPLE_RESULTS: TestResult[] = [
  { id: "1", testId: "login.spec.ts::logs in", status: "passed", durationMs: 1200, retryCount: 0, failureSignature: null },
  { id: "2", testId: "dashboard.spec.ts::renders panels", status: "passed", durationMs: 3400, retryCount: 0, failureSignature: null },
  { id: "3", testId: "dashboard.spec.ts::variable cascade", status: "failed", durationMs: 5000, retryCount: 2, failureSignature: "TimeoutError: panel not visible" },
  { id: "4", testId: "alerts.spec.ts::fires rule", status: "skipped", durationMs: null, retryCount: 0, failureSignature: null },
  { id: "5", testId: "network.spec.ts::chart loads", status: "flaky", durationMs: 2100, retryCount: 1, failureSignature: "flaky rendering" },
  { id: "6", testId: "CPU.spec.ts::renders without error", status: "failed", durationMs: 4500, retryCount: 3, failureSignature: "Error: no data" },
];

describe("Results filtering", () => {
  // ── Equivalence partitioning: status filter ──

  it("returns all results when filter is 'all'", () => {
    const result = filterResults(SAMPLE_RESULTS, "all", "");
    expect(result).toHaveLength(6);
  });

  it("filters by 'passed' status", () => {
    const result = filterResults(SAMPLE_RESULTS, "passed", "");
    expect(result).toHaveLength(2);
    expect(result.every((r) => r.status === "passed")).toBe(true);
  });

  it("filters by 'failed' status", () => {
    const result = filterResults(SAMPLE_RESULTS, "failed", "");
    expect(result).toHaveLength(2);
  });

  it("filters by 'flaky' status", () => {
    const result = filterResults(SAMPLE_RESULTS, "flaky", "");
    expect(result).toHaveLength(1);
    expect(result[0].testId).toContain("network");
  });

  it("filters by 'skipped' status", () => {
    const result = filterResults(SAMPLE_RESULTS, "skipped", "");
    expect(result).toHaveLength(1);
  });

  // ── Search filter ──

  it("filters by search term (case-insensitive)", () => {
    const result = filterResults(SAMPLE_RESULTS, "all", "dashboard");
    expect(result).toHaveLength(2);
  });

  it("search is case-insensitive", () => {
    const result = filterResults(SAMPLE_RESULTS, "all", "CPU");
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("6");
  });

  it("empty search returns all", () => {
    const result = filterResults(SAMPLE_RESULTS, "all", "");
    expect(result).toHaveLength(6);
  });

  it("no-match search returns empty", () => {
    const result = filterResults(SAMPLE_RESULTS, "all", "nonexistent");
    expect(result).toHaveLength(0);
  });

  // ── Combined filters ──

  it("status + search combined", () => {
    const result = filterResults(SAMPLE_RESULTS, "passed", "dashboard");
    expect(result).toHaveLength(1);
    expect(result[0].testId).toContain("renders panels");
  });

  it("status filter with no matching search returns empty", () => {
    const result = filterResults(SAMPLE_RESULTS, "failed", "login");
    expect(result).toHaveLength(0);
  });

  // ── Boundary: empty results array ──

  it("handles empty results array", () => {
    const result = filterResults([], "all", "");
    expect(result).toHaveLength(0);
  });
});

describe("Results stats computation", () => {
  it("computes correct stats for sample data", () => {
    const stats = computeStats(SAMPLE_RESULTS);
    expect(stats).toEqual({
      total: 6,
      passed: 2,
      failed: 2,
      skipped: 1,
      flaky: 1,
    });
  });

  it("handles all-passed results", () => {
    const allPassed = SAMPLE_RESULTS.map((r) => ({ ...r, status: "passed" }));
    const stats = computeStats(allPassed);
    expect(stats.passed).toBe(6);
    expect(stats.failed).toBe(0);
  });

  it("handles empty results", () => {
    const stats = computeStats([]);
    expect(stats).toEqual({ total: 0, passed: 0, failed: 0, skipped: 0, flaky: 0 });
  });

  // ── Boundary: single result ──

  it("handles single failed result", () => {
    const stats = computeStats([SAMPLE_RESULTS[2]]);
    expect(stats.total).toBe(1);
    expect(stats.failed).toBe(1);
    expect(stats.passed).toBe(0);
  });
});
