/**
 * Unit tests for the store-reporter's makeTestId helper (enhancement #8).
 *
 * Techniques:
 * - Equivalence partitioning: nested file, top-level file, file at root.
 * - Boundary values: file exactly equal to rootDir, empty relative result.
 * - Regression: absolute temp-dir paths must become repo-relative and match the
 *   on-disk catalog id format (`app_tests/.../foo.spec.ts::title`).
 * - Robustness: files outside rootDir fall back to the original path; titles
 *   containing "::" are preserved verbatim.
 */

import { describe, it, expect } from "vitest";
import path from "path";
import {
  makeTestId,
  outcomeToStatus,
  reduceToFinalAttempts,
} from "../fixtures/store-reporter";

describe("makeTestId", () => {
  const root = "/tmp/run-abc123";

  it("normalizes an absolute clone path to a repo-relative id", () => {
    const file = `${root}/app_tests/vm-cluster/dashboard-links.spec.ts`;
    expect(makeTestId(file, "shows links", root)).toBe(
      "app_tests/vm-cluster/dashboard-links.spec.ts::shows links"
    );
  });

  it("handles a top-level spec file", () => {
    expect(makeTestId(`${root}/smoke.spec.ts`, "loads", root)).toBe(
      "smoke.spec.ts::loads"
    );
  });

  it("matches the catalog id format for a nested app_tests path (regression)", () => {
    const file = `${root}/app_tests/uploaded/foo.spec.ts`;
    // This is the exact shape discoverAppTests produces (relative to repo root).
    expect(makeTestId(file, "my test @smoke", root)).toBe(
      "app_tests/uploaded/foo.spec.ts::my test @smoke"
    );
  });

  it("falls back to the original path when the file is outside rootDir", () => {
    const file = "/somewhere/else/other.spec.ts";
    expect(makeTestId(file, "t", root)).toBe(
      "/somewhere/else/other.spec.ts::t"
    );
  });

  it("preserves a title that itself contains '::'", () => {
    const file = `${root}/app_tests/a.spec.ts`;
    expect(makeTestId(file, "group::case", root)).toBe(
      "app_tests/a.spec.ts::group::case"
    );
  });

  it("defaults rootDir to process.cwd()", () => {
    const file = path.join(process.cwd(), "app_tests", "b.spec.ts");
    expect(makeTestId(file, "x")).toBe("app_tests/b.spec.ts::x");
  });

  it("does not emit a leading './' for files directly under rootDir", () => {
    const id = makeTestId(`${root}/c.spec.ts`, "y", root);
    expect(id.startsWith("./")).toBe(false);
    expect(id).toBe("c.spec.ts::y");
  });
});

describe("outcomeToStatus", () => {
  // Decision table over Playwright's four possible outcomes.
  it("maps 'expected' → 'passed'", () => {
    expect(outcomeToStatus("expected")).toBe("passed");
  });
  it("maps 'unexpected' → 'failed'", () => {
    expect(outcomeToStatus("unexpected")).toBe("failed");
  });
  it("maps 'flaky' → 'flaky'", () => {
    expect(outcomeToStatus("flaky")).toBe("flaky");
  });
  it("maps 'skipped' → 'skipped'", () => {
    expect(outcomeToStatus("skipped")).toBe("skipped");
  });
});

describe("reduceToFinalAttempts (retry double-insert fix)", () => {
  // Identity keys stand in for Playwright TestCase objects.
  const A = { id: "a" };
  const B = { id: "b" };

  it("collapses multiple attempts of one test to its final (highest-retry) result", () => {
    const entries = [
      { testCase: A, result: { retry: 0, status: "failed" } },
      { testCase: A, result: { retry: 1, status: "passed" } },
    ];
    const out = reduceToFinalAttempts(entries);
    expect(out).toHaveLength(1);
    expect(out[0].result.retry).toBe(1);
    expect(out[0].result.status).toBe("passed");
  });

  it("keeps the last of N failed attempts (no duplicate failed rows)", () => {
    const entries = [
      { testCase: A, result: { retry: 0, status: "failed" } },
      { testCase: A, result: { retry: 1, status: "failed" } },
      { testCase: A, result: { retry: 2, status: "failed" } },
    ];
    const out = reduceToFinalAttempts(entries);
    expect(out).toHaveLength(1);
    expect(out[0].result.retry).toBe(2);
  });

  it("keeps one entry per distinct test and preserves first-seen order", () => {
    const entries = [
      { testCase: A, result: { retry: 0, status: "passed" } },
      { testCase: B, result: { retry: 0, status: "failed" } },
      { testCase: B, result: { retry: 1, status: "passed" } },
    ];
    const out = reduceToFinalAttempts(entries);
    expect(out.map((e) => e.testCase)).toEqual([A, B]);
    expect(out).toHaveLength(2);
    expect(out[1].result.retry).toBe(1);
  });

  it("returns [] for no attempts", () => {
    expect(reduceToFinalAttempts([])).toEqual([]);
  });

  it("passes a single-attempt test through unchanged", () => {
    const entries = [{ testCase: A, result: { retry: 0, status: "passed" } }];
    expect(reduceToFinalAttempts(entries)).toEqual(entries);
  });
});
