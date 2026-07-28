/**
 * Pure helpers for the in-UI failure triage panel (#12).
 *
 * The triage endpoint can return two shapes:
 *  - ML service:  { target_test_id, similar_failures: [...] }
 *  - DB fallback: { suggestion: { similarFailures: [...], message } }
 * plus an optional top-level `message` when no data is available.
 *
 * `normalizeTriage` flattens both into a single, UI-friendly structure.
 */

import type { SimilarFailure, TriageResponse } from "./api";

export interface NormalizedSimilarFailure {
  testId: string;
  signature: string;
  similarity: number | null;
  commitSha: string | null;
  count: number | null;
}

export interface NormalizedTriage {
  similar: NormalizedSimilarFailure[];
  message: string | null;
}

function pick<T>(...vals: (T | undefined | null)[]): T | null {
  for (const v of vals) if (v !== undefined && v !== null) return v;
  return null;
}

/** Normalize one raw similar-failure record (handles snake_case and camelCase). */
export function normalizeSimilarFailure(f: SimilarFailure): NormalizedSimilarFailure {
  return {
    testId: pick(f.testId, f.test_id) ?? "unknown",
    signature: pick(f.failureSignature, f.failure_signature) ?? "",
    similarity: typeof f.similarity === "number" ? f.similarity : null,
    commitSha: pick(f.commit_sha) ?? null,
    count: typeof f.count === "number" ? f.count : null,
  };
}

/** Flatten either triage response shape into `{ similar, message }`. */
export function normalizeTriage(resp: TriageResponse | undefined | null): NormalizedTriage {
  if (!resp) return { similar: [], message: null };

  const rawList: SimilarFailure[] =
    resp.similar_failures ?? resp.suggestion?.similarFailures ?? [];

  const message =
    pick(resp.message, resp.suggestion?.message) ??
    (rawList.length === 0 ? "No similar historical failures found." : null);

  return {
    similar: rawList.map(normalizeSimilarFailure),
    message,
  };
}
