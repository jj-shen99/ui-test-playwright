/**
 * Unit tests for the local /results seed fixture builder (#25).
 *
 * Techniques: determinism (same anchor → identical output), boundary values on
 * runCount (clamped to [1, 60]), referential integrity (every result points at
 * a real run), and invariants on the derived health rows and id shape.
 */

import { describe, it, expect } from "vitest";
import {
  buildResultsFixture,
  fixtureId,
  FIXTURE_TESTS,
} from "../../tests/fixtures/results-fixture";

const ANCHOR = new Date("2025-06-01T00:00:00Z");

describe("fixtureId", () => {
  it("produces a uuid-v4-shaped, deterministic id", () => {
    const id = fixtureId("11111111", 3);
    expect(id).toMatch(/^[0-9a-f]{8}-0000-4000-8000-[0-9a-f]{12}$/);
    expect(fixtureId("11111111", 3)).toBe(id);
  });
});

describe("buildResultsFixture", () => {
  it("is deterministic for a given anchor", () => {
    const a = buildResultsFixture(ANCHOR, { runCount: 6 });
    const b = buildResultsFixture(ANCHOR, { runCount: 6 });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("emits the requested number of runs with results per test", () => {
    const f = buildResultsFixture(ANCHOR, { runCount: 5 });
    expect(f.runs).toHaveLength(5);
    expect(f.testResults).toHaveLength(5 * FIXTURE_TESTS.length);
  });

  it("clamps runCount to the [1, 60] range", () => {
    expect(buildResultsFixture(ANCHOR, { runCount: 0 }).runs).toHaveLength(1);
    expect(buildResultsFixture(ANCHOR, { runCount: 999 }).runs).toHaveLength(60);
  });

  it("defaults to 8 runs when runCount is omitted", () => {
    expect(buildResultsFixture(ANCHOR).runs).toHaveLength(8);
  });

  // Regression: NaN (e.g. a non-numeric `--runs abc` arg) must not silently
  // produce zero runs — it should fall back to the default.
  it("falls back to the default for NaN/undefined runCount", () => {
    expect(buildResultsFixture(ANCHOR, { runCount: NaN }).runs).toHaveLength(8);
    expect(
      buildResultsFixture(ANCHOR, { runCount: undefined }).runs
    ).toHaveLength(8);
  });

  it("floors a fractional runCount", () => {
    expect(buildResultsFixture(ANCHOR, { runCount: 4.9 }).runs).toHaveLength(4);
  });

  it("keeps referential integrity: every result belongs to a real run", () => {
    const f = buildResultsFixture(ANCHOR, { runCount: 8 });
    const runIds = new Set(f.runs.map((r) => r.id));
    for (const t of f.testResults) {
      expect(runIds.has(t.runId)).toBe(true);
    }
  });

  it("orders runs newest-first, one day apart", () => {
    const f = buildResultsFixture(ANCHOR, { runCount: 3 });
    expect(f.runs[0].createdAt.getTime()).toBe(ANCHOR.getTime());
    const dayMs = 24 * 60 * 60 * 1000;
    expect(f.runs[1].createdAt.getTime()).toBe(ANCHOR.getTime() - dayMs);
    expect(f.runs[2].createdAt.getTime()).toBe(ANCHOR.getTime() - 2 * dayMs);
  });

  it("marks a run failed iff it contains a failed result", () => {
    const f = buildResultsFixture(ANCHOR, { runCount: 8 });
    for (const run of f.runs) {
      const failed = f.testResults.some(
        (t) => t.runId === run.id && t.status === "failed"
      );
      expect(run.status).toBe(failed ? "failed" : "passed");
    }
  });

  it("attaches a failure signature to failed results only", () => {
    const f = buildResultsFixture(ANCHOR, { runCount: 12 });
    for (const t of f.testResults) {
      if (t.status === "failed") expect(t.failureSignature).toBeTruthy();
      else expect(t.failureSignature).toBeNull();
    }
  });

  it("derives health rows including one quarantined test", () => {
    const f = buildResultsFixture(ANCHOR);
    expect(f.testHealth.length).toBeGreaterThanOrEqual(1);
    expect(f.testHealth.some((h) => h.quarantined)).toBe(true);
    for (const h of f.testHealth) {
      expect(h.flakinessScore).toBeGreaterThanOrEqual(0);
      expect(h.flakinessScore).toBeLessThanOrEqual(1);
    }
  });
});
