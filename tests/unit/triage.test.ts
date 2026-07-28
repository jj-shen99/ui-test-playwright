/**
 * Unit tests for triage response normalization (#12): normalizeTriage,
 * normalizeSimilarFailure.
 *
 * Techniques: decision table over the two response shapes (ML vs DB fallback),
 * equivalence partitioning (snake_case vs camelCase fields), and edge cases
 * (empty, message-only, missing fields).
 */

import { describe, it, expect } from "vitest";
import { normalizeTriage, normalizeSimilarFailure } from "../../frontend/src/triage";
import type { TriageResponse } from "../../frontend/src/api";

describe("normalizeSimilarFailure", () => {
  it("reads snake_case fields (ML service shape)", () => {
    const n = normalizeSimilarFailure({
      test_id: "a.spec.ts::x",
      failure_signature: "TimeoutError",
      similarity: 0.83,
      commit_sha: "abc123",
    });
    expect(n.testId).toBe("a.spec.ts::x");
    expect(n.signature).toBe("TimeoutError");
    expect(n.similarity).toBe(0.83);
    expect(n.commitSha).toBe("abc123");
  });

  it("reads camelCase fields (DB fallback shape) and count", () => {
    const n = normalizeSimilarFailure({ testId: "b::y", failureSignature: "boom", count: 4 });
    expect(n.testId).toBe("b::y");
    expect(n.signature).toBe("boom");
    expect(n.count).toBe(4);
    expect(n.similarity).toBeNull();
  });

  it("falls back to 'unknown' testId and empty signature", () => {
    const n = normalizeSimilarFailure({});
    expect(n.testId).toBe("unknown");
    expect(n.signature).toBe("");
    expect(n.similarity).toBeNull();
    expect(n.commitSha).toBeNull();
    expect(n.count).toBeNull();
  });
});

describe("normalizeTriage", () => {
  it("returns empty for null/undefined", () => {
    expect(normalizeTriage(undefined)).toEqual({ similar: [], message: null });
    expect(normalizeTriage(null)).toEqual({ similar: [], message: null });
  });

  it("flattens the ML service shape (similar_failures)", () => {
    const resp: TriageResponse = {
      target_test_id: "t",
      similar_failures: [
        { test_id: "a", similarity: 0.9 },
        { test_id: "b", similarity: 0.7 },
      ],
    };
    const n = normalizeTriage(resp);
    expect(n.similar).toHaveLength(2);
    expect(n.similar[0].testId).toBe("a");
    expect(n.message).toBeNull();
  });

  it("flattens the DB fallback shape (suggestion.similarFailures)", () => {
    const resp: TriageResponse = {
      suggestion: {
        similarFailures: [{ testId: "x", count: 3 }],
        message: "ML service unavailable — showing basic matches",
      },
    };
    const n = normalizeTriage(resp);
    expect(n.similar).toHaveLength(1);
    expect(n.similar[0].testId).toBe("x");
    expect(n.message).toContain("ML service unavailable");
  });

  it("synthesizes a friendly message when there are no results", () => {
    const n = normalizeTriage({ suggestion: null });
    expect(n.similar).toEqual([]);
    expect(n.message).toMatch(/no similar/i);
  });

  it("prefers an explicit top-level message", () => {
    const n = normalizeTriage({ message: "failureId is required" });
    expect(n.message).toBe("failureId is required");
  });
});
