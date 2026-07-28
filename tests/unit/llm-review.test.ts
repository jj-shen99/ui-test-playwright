/**
 * Unit tests for the LLM draft review/diff gate (#22).
 *
 * Techniques: fence-stripping equivalence classes, a validation decision table
 * (each rule violated in isolation and a fully-valid draft), line-diff boundary
 * values (new file, additions, removals, identical), and the review decision
 * matrix (valid×approve).
 */

import { describe, it, expect } from "vitest";
import {
  extractSpecCode,
  validateDraftSpec,
  computeLineDiff,
  reviewLlmDraft,
} from "../../services/generation/review";

const VALID_DRAFT = `import { test, expect } from "@playwright/test";
import { GrafanaDashboardPage } from "../../pages/grafana-dashboard.page";

test("cpu panel renders", async ({ page }) => {
  const dash = new GrafanaDashboardPage(page);
  await dash.goto();
  await expect(page.getByText("CPU")).toBeVisible();
});
`;

describe("extractSpecCode", () => {
  it("strips ```ts fences", () => {
    const wrapped = "```ts\nconst a = 1;\n```";
    expect(extractSpecCode(wrapped)).toBe("const a = 1;");
  });

  it("strips bare ``` fences", () => {
    expect(extractSpecCode("```\nconst a = 1;\n```")).toBe("const a = 1;");
  });

  it("leaves unfenced code untouched (trimmed)", () => {
    expect(extractSpecCode("  const a = 1;  ")).toBe("const a = 1;");
  });
});

describe("validateDraftSpec", () => {
  it("accepts a well-formed draft", () => {
    const r = validateDraftSpec(VALID_DRAFT);
    expect(r.ok).toBe(true);
    expect(r.issues).toEqual([]);
    expect(r.warnings).toEqual([]);
  });

  // Regression: the word "time" (or timeout/runtime/comments) must not block a
  // draft. Previously a broad /time/i match falsely failed valid drafts.
  it("does not block a draft merely for mentioning time-related words", () => {
    const draft = VALID_DRAFT.replace(
      'test("cpu panel renders"',
      '// checks the CPU panel over runtime\ntest("cpu panel renders sometimes"'
    );
    const r = validateDraftSpec(draft);
    expect(r.ok).toBe(true);
    expect(r.warnings).toEqual([]);
  });

  it("warns (non-blocking) when a time range is pinned without seed constants", () => {
    const draft = VALID_DRAFT.replace(
      "await dash.goto();",
      'await page.goto("/d/abc?from=1700000000000&to=1700003600000");'
    );
    const r = validateDraftSpec(draft);
    expect(r.ok).toBe(true);
    expect(r.warnings.length).toBe(1);
    expect(r.warnings[0]).toContain("non-deterministic");
  });

  it("does not warn when the seed-window constants are used", () => {
    const draft = VALID_DRAFT.replace(
      "await dash.goto();",
      'await page.goto(`/d/abc?from=${SEED_FROM_EPOCH_MS}&to=${SEED_TO_EPOCH_MS}`);'
    );
    const r = validateDraftSpec(draft);
    expect(r.ok).toBe(true);
    expect(r.warnings).toEqual([]);
  });

  it("flags an empty draft", () => {
    expect(validateDraftSpec("   ").ok).toBe(false);
  });

  it("flags a draft with no test()", () => {
    const r = validateDraftSpec(
      `import { GrafanaDashboardPage } from "../../pages/grafana-dashboard.page";\nconst x = 1;`
    );
    expect(r.ok).toBe(false);
    expect(r.issues).toContain("no Playwright test() found");
  });

  it("flags a missing page-object import", () => {
    const r = validateDraftSpec(
      `import { test } from "@playwright/test";\ntest("x", async () => {});`
    );
    expect(r.issues).toContain(
      "does not import the shared GrafanaDashboardPage page object"
    );
  });

  it("flags test.only", () => {
    const draft = VALID_DRAFT.replace('test("cpu', 'test.only("cpu');
    const r = validateDraftSpec(draft);
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.includes("test.only"))).toBe(true);
  });

  it("flags fixed sleeps", () => {
    const draft = VALID_DRAFT.replace(
      "await dash.goto();",
      "await dash.goto();\n  await page.waitForTimeout(1000);"
    );
    const r = validateDraftSpec(draft);
    expect(r.issues.some((i) => i.includes("fixed sleep"))).toBe(true);
  });
});

describe("validateDraftSpec — book-guardrail rules (Ch3-6)", () => {
  // Helper: inject a line into the body of the valid draft (after goto) so the
  // draft stays otherwise-valid and we isolate the rule under test.
  const withBody = (line: string) =>
    VALID_DRAFT.replace("await dash.goto();", `await dash.goto();\n  ${line}`);

  // ── Ch5: missing-await on web-first assertions (hard block) ──

  it("blocks an un-awaited web-first assertion", () => {
    const draft = VALID_DRAFT.replace(
      'await expect(page.getByText("CPU")).toBeVisible();',
      'expect(page.getByText("CPU")).toBeVisible();'
    );
    const r = validateDraftSpec(draft);
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.includes("missing await"))).toBe(true);
  });

  it("accepts a return-ed web-first assertion (boundary: return counts)", () => {
    const draft = withBody('return expect(page.getByText("CPU")).toBeVisible();');
    const r = validateDraftSpec(draft);
    expect(r.issues.some((i) => i.includes("missing await"))).toBe(false);
  });

  it("does NOT flag a synchronous value matcher as missing-await", () => {
    // expect(await x.count()).toBeGreaterThan(0) is correct sync usage — the
    // matcher is not web-first, so it must not be reported as missing await.
    const draft = withBody(
      "expect(await page.getByRole(\"article\").count()).toBeGreaterThan(0);"
    );
    const r = validateDraftSpec(draft);
    expect(r.issues.some((i) => i.includes("missing await"))).toBe(false);
  });

  // ── Ch6: networkidle (hard block) ──

  it("blocks waitForLoadState('networkidle')", () => {
    const draft = withBody('await page.waitForLoadState("networkidle");');
    const r = validateDraftSpec(draft);
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.includes("networkidle"))).toBe(true);
  });

  // ── Ch4: force: true decision table (commented allowed, uncommented blocked) ──

  it("blocks an uncommented force: true", () => {
    const draft = withBody('await page.getByRole("button").click({ force: true });');
    const r = validateDraftSpec(draft);
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.includes("force: true"))).toBe(true);
  });

  it("allows force: true when a justifying comment is present", () => {
    const draft = withBody(
      'await page.getByRole("button").click({ force: true }); // under a decorative overlay by design'
    );
    const r = validateDraftSpec(draft);
    expect(r.issues.some((i) => i.includes("force: true"))).toBe(false);
  });

  // ── Ch2: page.pause() (hard block) ──

  it("blocks page.pause()", () => {
    const draft = withBody("await page.pause();");
    const r = validateDraftSpec(draft);
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.includes("page.pause()"))).toBe(true);
  });

  // ── Ch3/5/6: advisory warnings (never block) ──

  it("warns (non-blocking) on an extracted-value assertion", () => {
    const draft = withBody(
      "expect(await page.getByRole(\"article\").count()).toBeGreaterThan(0);"
    );
    const r = validateDraftSpec(draft);
    expect(r.ok).toBe(true);
    expect(r.warnings.some((w) => w.includes("extracted value"))).toBe(true);
  });

  it("warns (non-blocking) on a raw CSS/XPath locator", () => {
    const draft = withBody('await expect(page.locator(".card")).toBeVisible();');
    const r = validateDraftSpec(draft);
    expect(r.ok).toBe(true);
    expect(r.warnings.some((w) => w.includes("raw CSS/XPath"))).toBe(true);
  });

  it("warns (non-blocking) on .first()/.nth()", () => {
    const draft = withBody(
      'await expect(page.getByRole("article").first()).toBeVisible();'
    );
    const r = validateDraftSpec(draft);
    expect(r.ok).toBe(true);
    expect(r.warnings.some((w) => w.includes(".first()"))).toBe(true);
  });

  it("warns (non-blocking) on page.waitForFunction", () => {
    const draft = withBody("await page.waitForFunction(() => true);");
    const r = validateDraftSpec(draft);
    expect(r.ok).toBe(true);
    expect(r.warnings.some((w) => w.includes("waitForFunction"))).toBe(true);
  });
});

describe("computeLineDiff", () => {
  it("counts a brand-new file as all additions", () => {
    const d = computeLineDiff(null, "a\nb\nc");
    expect(d).toEqual({ added: 3, removed: 0, isNew: true });
  });

  it("reports zero changes for identical content", () => {
    const d = computeLineDiff("a\nb", "a\nb");
    expect(d).toMatchObject({ added: 0, removed: 0, isNew: false });
  });

  it("counts additions and removals", () => {
    const d = computeLineDiff("a\nb\nc", "a\nc\nd\ne");
    // removed: b ; added: d, e
    expect(d.removed).toBe(1);
    expect(d.added).toBe(2);
  });

  it("ignores blank lines", () => {
    const d = computeLineDiff("a\n\n\nb", "a\nb");
    expect(d).toMatchObject({ added: 0, removed: 0 });
  });
});

describe("reviewLlmDraft", () => {
  it("blocks an invalid draft regardless of approval", () => {
    const outcome = reviewLlmDraft({
      rawContent: "```\nconst nope = 1;\n```",
      existingContent: null,
      approve: true,
      path: "generated/x/llm.draft.spec.ts",
    });
    expect(outcome.approved).toBe(false);
    expect(outcome.validation.ok).toBe(false);
    expect(outcome.summary).toContain("BLOCKED");
  });

  it("parks a valid draft that is not approved", () => {
    const outcome = reviewLlmDraft({
      rawContent: VALID_DRAFT,
      existingContent: null,
      approve: false,
      path: "generated/x/llm.draft.spec.ts",
    });
    expect(outcome.validation.ok).toBe(true);
    expect(outcome.approved).toBe(false);
    expect(outcome.summary).toContain("pending review");
    expect(outcome.diff.isNew).toBe(true);
  });

  it("approves a valid draft when approval is requested", () => {
    const outcome = reviewLlmDraft({
      rawContent: VALID_DRAFT,
      existingContent: null,
      approve: true,
      path: "generated/x/llm.draft.spec.ts",
    });
    expect(outcome.approved).toBe(true);
    expect(outcome.summary).toContain("approved");
  });

  it("approves a valid draft that only has warnings (warnings never block)", () => {
    const draft = VALID_DRAFT.replace(
      "await dash.goto();",
      'await page.goto("/d/abc?from=1700000000000&to=1700003600000");'
    );
    const outcome = reviewLlmDraft({
      rawContent: draft,
      existingContent: null,
      approve: true,
      path: "p",
    });
    expect(outcome.approved).toBe(true);
    expect(outcome.validation.warnings.length).toBe(1);
    expect(outcome.summary).toContain("warnings:");
  });

  it("strips fences from the reviewed code", () => {
    const outcome = reviewLlmDraft({
      rawContent: "```ts\n" + VALID_DRAFT + "\n```",
      existingContent: null,
      approve: false,
      path: "p",
    });
    expect(outcome.code.startsWith("import")).toBe(true);
    expect(outcome.code).not.toContain("```");
  });
});
