/**
 * Pure helpers for discovering tests on disk under app_tests/ and classifying
 * their type. Extracted from the tests route so they can be unit-tested without
 * a database connection.
 */

import fs from "fs";
import path from "path";

export const VALID_TEST_TYPES = ["smoke", "sanity", "regression", "e2e"] as const;
export type TestType = (typeof VALID_TEST_TYPES)[number];

// Repo root: this file lives at services/api/routes/test-discovery.ts
export const PROJECT_ROOT =
  process.env.PROJECT_ROOT || path.resolve(__dirname, "../../..");
export const APP_TESTS_DIR = path.join(PROJECT_ROOT, "app_tests");
export const UPLOADED_DIR = path.join(APP_TESTS_DIR, "uploaded");

/**
 * Sanitize a user-supplied spec filename to a safe basename ending in
 * `.spec.ts`. Strips any directory components (defeating path traversal such as
 * `../../etc/passwd`) and rejects names with disallowed characters.
 * Returns null when the name cannot be made safe.
 */
export function sanitizeSpecFileName(raw: string): string | null {
  if (!raw || typeof raw !== "string") return null;
  // Take the basename only — strip any path components (both separators).
  let name = (raw.replace(/\\/g, "/").split("/").pop() ?? "").trim();
  if (!name || name === "." || name === "..") return null;
  // Only allow a conservative charset; blocks traversal and shell-y names.
  if (!/^[A-Za-z0-9._-]+$/.test(name)) return null;
  // Normalize the extension to .spec.ts
  if (name.endsWith(".spec.ts")) return name;
  if (name.endsWith(".ts")) return name.slice(0, -3) + ".spec.ts";
  return name + ".spec.ts";
}

export interface DiscoveredTest {
  testId: string; // `<relative file>::<title>`
  file: string; // relative to repo root
  title: string;
  derivedType: string; // from @tags annotation, else 'unknown'
  caseName: string; // human-friendly test-case name (describe title / file base)
}

/** Recursively collect *.spec.ts files under a directory. */
export function findSpecFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules") continue;
      out.push(...findSpecFiles(full));
    } else if (entry.isFile() && /\.spec\.ts$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Extract a test type from a `@tags ...` annotation in the file source.
 *
 * The tag list is read from the SAME line only (no `\s`/newline in the class),
 * so unrelated type words appearing later in the file cannot leak into the
 * classification.
 */
export function deriveTypeFromSource(source: string): string {
  const tagMatch = source.match(/@tags[ \t]+([a-zA-Z0-9,\- ]+)/);
  if (tagMatch) {
    const tags = tagMatch[1].toLowerCase();
    for (const t of VALID_TEST_TYPES) {
      if (new RegExp(`\\b${t}\\b`).test(tags)) return t;
    }
  }
  return "unknown";
}

/**
 * Extract the first `test.describe("...")` title from a spec file's source, to
 * use as the human-friendly "test case" name. Only plain string/template
 * literals are read; a trailing `@tag` token (e.g. `@sanity`) is stripped.
 * Returns null when there is no describe block (or its title is a dynamic
 * expression we can't read statically).
 */
export function parseDescribeTitle(source: string): string | null {
  const m = source.match(
    /\btest\.describe(?:\.(?:only|skip|serial|parallel|configure))?\s*\(\s*(['"`])((?:\\.|(?!\1).)*)\1/
  );
  if (!m) return null;
  const raw = m[2].trim();
  // Skip titles that are dynamic template expressions we can't resolve.
  if (/\$\{/.test(raw)) return null;
  // Drop a trailing "@tag" token used for type classification.
  const cleaned = raw.replace(/\s*@[a-zA-Z0-9_-]+\s*$/, "").trim();
  return cleaned || null;
}

/**
 * Human-friendly test-case name for a file: the first describe title if present,
 * otherwise the file's basename without the `.spec.ts` suffix (dashes/underscores
 * turned into spaces).
 */
export function deriveCaseName(source: string, relFile: string): string {
  const describeTitle = parseDescribeTitle(source);
  if (describeTitle) return describeTitle;
  const base = (relFile.split("/").pop() ?? relFile).replace(/\.spec\.ts$/, "");
  return base.replace(/[-_]+/g, " ").trim() || relFile;
}

/** Parse individual test titles from a spec file's source. */
export function parseTestTitles(source: string): string[] {
  const titles: string[] = [];
  // Matches test(, test.only(, test.skip(, test.fixme( with a string/template title.
  const re = /\btest(?:\.(?:only|skip|fixme))?\s*\(\s*(['"`])((?:\\.|(?!\1).)*)\1/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    titles.push(m[2]);
  }
  return titles;
}

/**
 * Find the byte range `[start, end)` of the whole `test(...)` statement whose
 * title matches `title`. Scans from the opening `(` of the call and balances
 * parentheses while skipping string/template literals and comments, so braces
 * or parens inside the test body/strings don't throw off the match. The end
 * consumes an optional trailing `;`. Returns null when the title is not found.
 */
export function findTestBlock(
  source: string,
  title: string
): { start: number; end: number } | null {
  const re = /\btest(?:\.(?:only|skip|fixme))?\s*\(\s*(['"`])((?:\\.|(?!\1).)*)\1/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    if (m[2] !== title) continue;
    const start = m.index;
    // Locate the opening paren of the test call (first '(' after `test`).
    const openParen = source.indexOf("(", start);
    if (openParen < 0) return null;

    let depth = 0;
    let i = openParen;
    let str: string | null = null; // active string/template delimiter
    for (; i < source.length; i++) {
      const ch = source[i];

      if (str) {
        if (ch === "\\") {
          i++; // skip escaped char
          continue;
        }
        if (ch === str) str = null;
        continue;
      }

      // Skip comments (only when not inside a string).
      if (ch === "/" && source[i + 1] === "/") {
        const nl = source.indexOf("\n", i);
        if (nl < 0) return null;
        i = nl;
        continue;
      }
      if (ch === "/" && source[i + 1] === "*") {
        const close = source.indexOf("*/", i + 2);
        if (close < 0) return null;
        i = close + 1;
        continue;
      }

      if (ch === "'" || ch === '"' || ch === "`") {
        str = ch;
        continue;
      }

      if (ch === "(") depth++;
      else if (ch === ")") {
        depth--;
        if (depth === 0) {
          let end = i + 1;
          if (source[end] === ";") end++;
          return { start, end };
        }
      }
    }
    return null; // unbalanced
  }
  return null;
}

/**
 * Remove the single `test(...)` block with the given title from source. Returns
 * the new source and how many blocks remain, or null when the title isn't
 * found. Trims leftover blank lines created by the excision.
 */
export function removeTestByTitle(
  source: string,
  title: string
): { source: string; remaining: number } | null {
  const block = findTestBlock(source, title);
  if (!block) return null;
  const before = source.slice(0, block.start);
  const after = source.slice(block.end);
  // Collapse the blank-line gap left behind: trailing whitespace of `before`
  // plus leading blank lines of `after` become a single newline separator.
  const merged = before.replace(/[ \t]*$/, "").replace(/\n\s*$/, "\n") +
    after.replace(/^[ \t]*\n/, "");
  const cleaned = merged.replace(/\n{3,}/g, "\n\n");

  // Integrity guard: a correct excision removes exactly one test() from the
  // file. If the count didn't drop by exactly one (e.g. a regex literal in the
  // body threw off paren-matching and we cut too much or too little), refuse to
  // rewrite rather than risk corrupting the file.
  const remaining = parseTestTitles(cleaned).length;
  if (remaining !== parseTestTitles(source).length - 1) return null;

  return { source: cleaned, remaining };
}

/** Reasons a rename can be rejected, for precise API error messages. */
export type RenameError =
  | "not-found" // no test with oldTitle
  | "empty" // newTitle is blank
  | "unchanged" // newTitle === oldTitle
  | "duplicate" // newTitle already exists in the file
  | "invalid"; // newTitle has characters we won't safely embed

/**
 * Rename the single `test()` titled `oldTitle` to `newTitle` in `source`.
 * Only the title string literal is rewritten (the body is untouched). Returns
 * the new source, or a `RenameError` describing why it was rejected. Pure and
 * unit-testable.
 */
export function renameTestInSource(
  source: string,
  oldTitle: string,
  newTitle: string
): { source: string } | { error: RenameError } {
  const trimmed = newTitle;
  if (!trimmed || !trimmed.trim()) return { error: "empty" };
  if (trimmed === oldTitle) return { error: "unchanged" };
  // Disallow control chars / newlines that would break a single-line title.
  if (/[\n\r]/.test(trimmed)) return { error: "invalid" };

  const titles = parseTestTitles(source);
  if (!titles.includes(oldTitle)) return { error: "not-found" };
  if (titles.includes(trimmed)) return { error: "duplicate" };

  const block = findTestBlock(source, oldTitle);
  if (!block) return { error: "not-found" };

  // Locate the title literal within the block and rewrite only its contents.
  const region = source.slice(block.start, block.end);
  const re = /(\btest(?:\.(?:only|skip|fixme))?\s*\(\s*)(['"`])((?:\\.|(?!\2).)*)\2/;
  const m = re.exec(region);
  if (!m || m[3] !== oldTitle) return { error: "not-found" };

  const delim = m[2];
  // Escape backslashes and the delimiter; reject unescapable template syntax.
  if (delim === "`" && /`|\$\{/.test(trimmed)) return { error: "invalid" };
  const escaped = trimmed.replace(/\\/g, "\\\\").replace(
    new RegExp(delim, "g"),
    `\\${delim}`
  );

  const literalStart = block.start + m.index + m[1].length; // at opening delim
  const literalEnd = literalStart + m[2].length + m[3].length + m[2].length;
  const rewritten =
    source.slice(0, literalStart) +
    `${delim}${escaped}${delim}` +
    source.slice(literalEnd);

  // Integrity guard: exactly the intended title set change occurred. Compare
  // against the *escaped* literal content, since parseTestTitles returns the
  // raw (still-escaped) text between the quotes.
  const after = parseTestTitles(rewritten);
  if (after.includes(oldTitle) || !after.includes(escaped)) {
    return { error: "not-found" };
  }
  return { source: rewritten };
}

/** Discover all tests under app_tests/, with their tag-derived type. */
export function discoverAppTests(appTestsDir: string = APP_TESTS_DIR): DiscoveredTest[] {
  const files = findSpecFiles(appTestsDir);
  const discovered: DiscoveredTest[] = [];
  for (const file of files) {
    const source = fs.readFileSync(file, "utf-8");
    const derivedType = deriveTypeFromSource(source);
    const relFile = path.relative(PROJECT_ROOT, file);
    const caseName = deriveCaseName(source, relFile);
    for (const title of parseTestTitles(source)) {
      discovered.push({
        testId: `${relFile}::${title}`,
        file: relFile,
        title,
        derivedType,
        caseName,
      });
    }
  }
  return discovered.sort((a, b) => a.testId.localeCompare(b.testId));
}
