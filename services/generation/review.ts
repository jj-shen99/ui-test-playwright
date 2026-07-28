/**
 * LLM draft review/diff gate (#22).
 *
 * LLM-generated specs are never written straight into the active suite. Each
 * draft is:
 *   1. stripped of markdown fences,
 *   2. validated against a set of safety rules (must look like a real spec, no
 *      `.only`, no fixed sleeps, must use the shared page object), and
 *   3. diffed against any existing file at the same path,
 * and only written into the repo when it is explicitly approved. Unapproved
 * drafts land in a review directory with a summary so a human can inspect the
 * diff before enabling them.
 *
 * All functions here are pure/deterministic and unit-tested; the generator
 * handles the actual file I/O.
 */

export interface DraftValidation {
  ok: boolean;
  /** Hard failures that block a draft from being enabled. */
  issues: string[];
  /** Advisory notes surfaced to the reviewer; they do NOT block approval. */
  warnings: string[];
}

/**
 * Web-first (retrying) assertion matchers. Used to detect the Chapter 5 gotcha:
 * an un-awaited web-first assertion is a floating promise that silently checks
 * nothing. A missing `await` in front of one of these is a hard failure.
 */
const WEB_FIRST_MATCHERS = [
  "toBeVisible",
  "toBeHidden",
  "toBeAttached",
  "toBeChecked",
  "toBeDisabled",
  "toBeEditable",
  "toBeEmpty",
  "toBeEnabled",
  "toBeFocused",
  "toBeInViewport",
  "toContainText",
  "toContainClass",
  "toHaveAccessibleName",
  "toHaveAccessibleDescription",
  "toHaveAttribute",
  "toHaveClass",
  "toHaveCount",
  "toHaveCSS",
  "toHaveId",
  "toHaveJSProperty",
  "toHaveScreenshot",
  "toHaveText",
  "toHaveTitle",
  "toHaveURL",
  "toHaveValue",
  "toHaveValues",
];

/**
 * Flag web-first assertions that are missing an `await` (or `return`). This is
 * the Chapter 5 rule — the "cheapest bug-prevention in the book" — enforced on
 * LLM drafts the same way the ESLint plugin enforces it on hand-written specs.
 *
 * Heuristic: for every retrying matcher call, walk back to the nearest
 * `expect` that owns it and confirm the token immediately before that `expect`
 * is `await` or `return`. Synchronous value matchers (`toBe`, `toEqual`,
 * `toBeGreaterThan`, …) are intentionally NOT in the list, so
 * `expect(await x.count()).toBeGreaterThan(0)` is correctly left alone.
 */
function countMissingAwaitAssertions(src: string): number {
  const matcherAlt = WEB_FIRST_MATCHERS.join("|");
  const re = new RegExp(`\\.(?:${matcherAlt})\\s*\\(`, "g");
  let count = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    const before = src.slice(0, m.index);
    const expectIdx = before.lastIndexOf("expect");
    if (expectIdx === -1) continue;
    const preceding = before.slice(0, expectIdx);
    const tok = preceding.match(/(\w+)\s*$/);
    const prevToken = tok ? tok[1] : "";
    if (prevToken === "await" || prevToken === "return") continue;
    count += 1;
  }
  return count;
}

/** True when a `force: true` occurrence carries an explanatory comment on the
 * same line — Chapter 4's rule: an uncommented `force: true` is a blocker. */
function hasUncommentedForce(src: string): boolean {
  const lines = src.split(/\r?\n/);
  return lines.some(
    (line) => /\bforce:\s*true\b/.test(line) && !line.includes("//")
  );
}

/** Strip a single leading/trailing markdown code fence, if present. */
export function extractSpecCode(raw: string): string {
  let code = raw.trim();
  // Opening fence: ``` or ```ts / ```typescript
  code = code.replace(/^```(?:typescript|ts|tsx|javascript|js)?[ \t]*\r?\n/, "");
  // Closing fence
  code = code.replace(/\r?\n```[ \t]*$/, "");
  return code.trim();
}

/**
 * Validate a draft spec against safety rules before it can be reviewed/enabled.
 * Returns every issue found (not just the first) so the reviewer sees the full
 * picture.
 */
export function validateDraftSpec(code: string): DraftValidation {
  const issues: string[] = [];
  const warnings: string[] = [];
  const src = code.trim();

  if (src.length === 0) {
    return { ok: false, issues: ["draft is empty"], warnings };
  }
  if (!/\btest\s*\(/.test(src) && !/\btest\.(?:describe|step)\s*\(/.test(src)) {
    issues.push("no Playwright test() found");
  }
  if (!/from\s+['"].*pages\/grafana-dashboard\.page['"]/.test(src)) {
    issues.push("does not import the shared GrafanaDashboardPage page object");
  }
  if (/\btest\.only\s*\(|\btest\.describe\.only\s*\(/.test(src)) {
    issues.push("contains test.only (would silently skip the rest of the suite)");
  }
  if (/\bpage\.waitForTimeout\s*\(/.test(src) || /\bwaitForTimeout\s*\(/.test(src)) {
    issues.push("uses a fixed sleep (waitForTimeout) instead of a render signal");
  }
  // Ch5: an un-awaited web-first assertion is a floating promise that checks
  // nothing — the highest-value guardrail in the book.
  const missingAwait = countMissingAwaitAssertions(src);
  if (missingAwait > 0) {
    issues.push(
      `${missingAwait} web-first assertion(s) missing await (silently checks nothing)`
    );
  }
  // Ch6: on a live Grafana dashboard the network never goes quiet, so
  // networkidle either hangs to timeout or resolves at a meaningless moment.
  if (/networkidle/.test(src)) {
    issues.push(
      "waits for 'networkidle' — never settles on a continuously-polling dashboard"
    );
  }
  // Ch4: force skips the actionability checks, so a passing test can describe a
  // page a real user could not use. Allowed only with a justifying comment.
  if (hasUncommentedForce(src)) {
    issues.push(
      "uses force: true without an explanatory comment (skips actionability checks)"
    );
  }
  // Ch2: page.pause() halts the run waiting for a human — never ship it.
  if (/\bpage\.pause\s*\(/.test(src)) {
    issues.push("contains page.pause() (would hang the run in CI)");
  }

  // ── Advisory (non-blocking) locator-ladder & assertion smells (Ch3/Ch5/Ch6) ──

  // Ch5: extracting a value and asserting on the dead string reintroduces the
  // asserted-too-soon race; prefer a retrying assertion on the live locator.
  if (/\bexpect\s*\(\s*await\b/.test(src)) {
    warnings.push(
      "asserts on an extracted value (expect(await …)) — prefer a web-first assertion on the locator"
    );
  }
  // Ch3: raw CSS/XPath locators couple to markup; prefer role/label/testid.
  if (/\.locator\(\s*['"`]/.test(src)) {
    warnings.push(
      "uses a raw CSS/XPath locator — prefer getByRole/getByLabel/getByTestId (locator ladder)"
    );
  }
  // Ch3: .first()/.last()/.nth() usually mean ambiguity silenced without thought.
  if (/\.(?:first|last|nth)\s*\(/.test(src)) {
    warnings.push(
      "uses .first()/.last()/.nth() — narrow the locator by scoping/filtering instead"
    );
  }
  // Ch6: waitForFunction is the last-resort escape hatch; a visible consequence
  // is almost always assertable instead.
  if (/\bwaitForFunction\s*\(/.test(src)) {
    warnings.push(
      "uses page.waitForFunction — prefer asserting a visible consequence"
    );
  }

  // Advisory (non-blocking): a draft that pins a dashboard time range via URL
  // params should use the deterministic seed-window constants, otherwise the
  // query window is non-reproducible. Narrowly triggered on actual time-range
  // usage (from=/to= params or dashboardUrl) rather than any mention of "time",
  // to avoid false positives on comments, "timeout", "runtime", etc.
  const usesTimeRange =
    /[?&](?:from|to)=/.test(src) || /\bdashboardUrl\s*\(/.test(src);
  const usesSeedConstants = /\b(?:SEED_FROM_EPOCH_MS|SEED_TO_EPOCH_MS)\b/.test(src);
  if (usesTimeRange && !usesSeedConstants) {
    warnings.push(
      "pins a time range without the SEED_*_EPOCH_MS constants — window may be non-deterministic"
    );
  }

  return { ok: issues.length === 0, issues, warnings };
}

export interface LineDiff {
  added: number;
  removed: number;
  /** True when there was no prior file (a brand-new draft). */
  isNew: boolean;
}

/**
 * Compute a minimal line-level diff summary between two texts. Counts lines that
 * appear only in `next` as additions and lines only in `prev` as removals using
 * a multiset comparison — enough for a reviewer-facing summary without pulling
 * in a full diff library. Pure.
 */
export function computeLineDiff(prev: string | null, next: string): LineDiff {
  const nextLines = splitLines(next);
  if (prev === null) {
    return { added: nextLines.length, removed: 0, isNew: true };
  }
  const prevCounts = toCounts(splitLines(prev));
  const nextCounts = toCounts(nextLines);

  let added = 0;
  let removed = 0;
  const keys = new Set([...prevCounts.keys(), ...nextCounts.keys()]);
  for (const key of keys) {
    const p = prevCounts.get(key) ?? 0;
    const n = nextCounts.get(key) ?? 0;
    if (n > p) added += n - p;
    else if (p > n) removed += p - n;
  }
  return { added, removed, isNew: false };
}

function splitLines(text: string): string[] {
  return text.replace(/\r\n/g, "\n").split("\n").filter((l) => l.trim().length > 0);
}

function toCounts(lines: string[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const line of lines) {
    const key = line.trim();
    m.set(key, (m.get(key) ?? 0) + 1);
  }
  return m;
}

export interface ReviewOutcome {
  /** The cleaned draft source. */
  code: string;
  validation: DraftValidation;
  diff: LineDiff;
  /** Whether the draft is allowed to be written into the active suite. */
  approved: boolean;
  /** Human-readable one-line summary. */
  summary: string;
}

/**
 * Run the full review gate for one draft: clean → validate → diff → decide.
 * A draft is only `approved` when validation passes AND the caller requested
 * approval. Pure — the generator performs file writes based on this outcome.
 */
export function reviewLlmDraft(opts: {
  rawContent: string;
  existingContent: string | null;
  approve: boolean;
  path: string;
}): ReviewOutcome {
  const code = extractSpecCode(opts.rawContent);
  const validation = validateDraftSpec(code);
  const diff = computeLineDiff(opts.existingContent, code);
  const approved = opts.approve && validation.ok;

  const diffStr = diff.isNew
    ? `new file (+${diff.added})`
    : `+${diff.added}/-${diff.removed}`;
  const warnSuffix =
    validation.warnings.length > 0
      ? ` [warnings: ${validation.warnings.join("; ")}]`
      : "";
  let summary: string;
  if (!validation.ok) {
    summary = `${opts.path}: BLOCKED — ${validation.issues.join("; ")}`;
  } else if (approved) {
    summary = `${opts.path}: approved (${diffStr})${warnSuffix}`;
  } else {
    summary = `${opts.path}: pending review (${diffStr}) — re-run with --approve to enable${warnSuffix}`;
  }

  return { code, validation, diff, approved, summary };
}
