/**
 * Unit tests for app_tests discovery helpers:
 * deriveTypeFromSource, parseTestTitles, findSpecFiles, discoverAppTests.
 *
 * Techniques: equivalence partitioning (each type), regression (multi-line
 * tag-leak bug), boundary values (0/1/N tests, nested dirs), integration
 * (discoverAppTests over a real temp directory tree).
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import {
  deriveTypeFromSource,
  parseTestTitles,
  parseDescribeTitle,
  deriveCaseName,
  findSpecFiles,
  discoverAppTests,
  sanitizeSpecFileName,
  findTestBlock,
  removeTestByTitle,
  renameTestInSource,
  VALID_TEST_TYPES,
} from "../../services/api/routes/test-discovery";

describe("deriveTypeFromSource", () => {
  it.each(VALID_TEST_TYPES)("derives '%s' from a matching @tags annotation", (type) => {
    expect(deriveTypeFromSource(`/** @tags ${type} */`)).toBe(type);
  });

  it("returns 'unknown' when no @tags annotation is present", () => {
    expect(deriveTypeFromSource("import { test } from '@playwright/test';")).toBe("unknown");
  });

  it("returns 'unknown' for a non-type tag", () => {
    expect(deriveTypeFromSource("* @tags flaky, wip")).toBe("unknown");
  });

  it("picks the type from a comma-separated tag list", () => {
    expect(deriveTypeFromSource("* @tags slow, regression")).toBe("regression");
  });

  it("is case-insensitive", () => {
    expect(deriveTypeFromSource("* @tags E2E")).toBe("e2e");
  });

  // ── REGRESSION: tag classification must not span lines ──
  // Previously the char class included \s, so a later line mentioning another
  // type word could hijack the classification (and priority-order returned
  // 'smoke' over the real tag). Pin the correct behavior.
  it("does not let a later line's type word leak into classification", () => {
    const source = [
      " * @tags sanity",
      " run smoke tests here",
      " */",
    ].join("\n");
    expect(deriveTypeFromSource(source)).toBe("sanity");
  });

  it("reads only the tag line even without a comment star guard", () => {
    const source = "@tags e2e\nregression coverage described below\n";
    expect(deriveTypeFromSource(source)).toBe("e2e");
  });

  it("handles tab separation after @tags", () => {
    expect(deriveTypeFromSource("@tags\tsmoke")).toBe("smoke");
  });
});

describe("parseTestTitles", () => {
  it("extracts a single double-quoted title", () => {
    expect(parseTestTitles(`test("does a thing", async () => {});`)).toEqual(["does a thing"]);
  });

  it("extracts single-quoted and template-literal titles", () => {
    const src = `test('a');\ntest(\`b\`);`;
    expect(parseTestTitles(src)).toEqual(["a", "b"]);
  });

  it("extracts titles from test.only / test.skip / test.fixme", () => {
    const src = `test.only("x", ()=>{});\ntest.skip("y", ()=>{});\ntest.fixme("z", ()=>{});`;
    expect(parseTestTitles(src)).toEqual(["x", "y", "z"]);
  });

  it("does NOT treat test.describe as a test", () => {
    const src = `test.describe("suite", () => {\n  test("real one", ()=>{});\n});`;
    expect(parseTestTitles(src)).toEqual(["real one"]);
  });

  it("does not match 'retest(' (word boundary)", () => {
    expect(parseTestTitles(`retest("nope", ()=>{});`)).toEqual([]);
  });

  it("returns empty array when there are no tests", () => {
    expect(parseTestTitles("const x = 1;")).toEqual([]);
  });

  it("handles titles containing escaped quotes", () => {
    expect(parseTestTitles(`test("say \\"hi\\"", ()=>{});`)).toEqual([`say \\"hi\\"`]);
  });

  it("extracts multiple titles across a file (N boundary)", () => {
    const src = `test("one",()=>{});test("two",()=>{});test("three",()=>{});`;
    expect(parseTestTitles(src)).toHaveLength(3);
  });
});

describe("parseDescribeTitle", () => {
  it("extracts a plain double-quoted describe title", () => {
    expect(parseDescribeTitle(`test.describe("My suite", () => {});`)).toBe("My suite");
  });

  it("extracts single-quoted and template (no-interp) titles", () => {
    expect(parseDescribeTitle(`test.describe('S', () => {});`)).toBe("S");
    expect(parseDescribeTitle("test.describe(`S`, () => {});")).toBe("S");
  });

  it("strips a trailing @tag token used for classification", () => {
    expect(parseDescribeTitle(`test.describe("Login flow @sanity", () => {});`)).toBe(
      "Login flow"
    );
  });

  it("handles describe modifiers (.only/.serial/.configure)", () => {
    expect(parseDescribeTitle(`test.describe.only("X", () => {});`)).toBe("X");
    expect(parseDescribeTitle(`test.describe.serial("Y @e2e", () => {});`)).toBe("Y");
  });

  it("returns null for a dynamic template-literal title (can't resolve statically)", () => {
    expect(parseDescribeTitle("test.describe(`case ${NAME}`, () => {});")).toBeNull();
  });

  it("returns null when there is no describe block", () => {
    expect(parseDescribeTitle(`test("just a test", () => {});`)).toBeNull();
  });

  it("reads the first describe when several are present", () => {
    const src = `test.describe("first", ()=>{});\ntest.describe("second", ()=>{});`;
    expect(parseDescribeTitle(src)).toBe("first");
  });
});

describe("deriveCaseName", () => {
  it("uses the describe title when present", () => {
    expect(
      deriveCaseName(`test.describe("Nice name @smoke", ()=>{});`, "app_tests/x.spec.ts")
    ).toBe("Nice name");
  });

  it("falls back to a humanized file basename when there is no describe", () => {
    expect(deriveCaseName(`test("a", ()=>{});`, "app_tests/vm-cluster/label-values-request.spec.ts")).toBe(
      "label values request"
    );
  });

  it("falls back for a dynamic describe title too", () => {
    expect(
      deriveCaseName("test.describe(`c ${X}`, ()=>{});", "app_tests/my_case.spec.ts")
    ).toBe("my case");
  });
});

describe("sanitizeSpecFileName", () => {
  // ── normalization (equivalence partitioning) ──
  it("keeps a valid .spec.ts name unchanged", () => {
    expect(sanitizeSpecFileName("login.spec.ts")).toBe("login.spec.ts");
  });

  it("upgrades a plain .ts name to .spec.ts", () => {
    expect(sanitizeSpecFileName("login.ts")).toBe("login.spec.ts");
  });

  it("appends .spec.ts when there is no extension", () => {
    expect(sanitizeSpecFileName("login")).toBe("login.spec.ts");
  });

  it("allows dots, dashes, underscores", () => {
    expect(sanitizeSpecFileName("vm-cluster_v2.spec.ts")).toBe("vm-cluster_v2.spec.ts");
  });

  // ── security: path traversal must be defeated ──
  it("strips POSIX directory components", () => {
    expect(sanitizeSpecFileName("../../etc/passwd")).toBe("passwd.spec.ts");
  });

  it("strips Windows-style directory components", () => {
    expect(sanitizeSpecFileName("..\\..\\secret")).toBe("secret.spec.ts");
  });

  it("takes only the basename of a nested path", () => {
    expect(sanitizeSpecFileName("app_tests/sub/x.spec.ts")).toBe("x.spec.ts");
  });

  // ── rejection (boundary / invalid) ──
  it("rejects empty / whitespace names", () => {
    expect(sanitizeSpecFileName("")).toBeNull();
    expect(sanitizeSpecFileName("   ")).toBeNull();
  });

  it("rejects '.' and '..'", () => {
    expect(sanitizeSpecFileName(".")).toBeNull();
    expect(sanitizeSpecFileName("..")).toBeNull();
  });

  it("rejects names with spaces or shell metacharacters", () => {
    expect(sanitizeSpecFileName("a b.spec.ts")).toBeNull();
    expect(sanitizeSpecFileName("a;rm -rf.spec.ts")).toBeNull();
    expect(sanitizeSpecFileName("a$b.ts")).toBeNull();
  });

  it("rejects non-string input", () => {
    expect(sanitizeSpecFileName(undefined as unknown as string)).toBeNull();
  });
});

describe("findSpecFiles / discoverAppTests (integration over temp dir)", () => {
  let tmp: string;

  beforeAll(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "disco-"));
    // nested dir with two spec files + a non-spec file + node_modules to skip
    fs.mkdirSync(path.join(tmp, "sub"), { recursive: true });
    fs.mkdirSync(path.join(tmp, "node_modules"), { recursive: true });
    fs.writeFileSync(
      path.join(tmp, "a.spec.ts"),
      `/** @tags smoke */\ntest.describe("Case A @smoke", () => {\ntest("a1", ()=>{});\ntest("a2", ()=>{});\n});`
    );
    fs.writeFileSync(
      path.join(tmp, "sub", "b.spec.ts"),
      `/** @tags e2e */\ntest("b1", ()=>{});`
    );
    fs.writeFileSync(path.join(tmp, "helper.ts"), `export const x = 1;`);
    fs.writeFileSync(
      path.join(tmp, "node_modules", "c.spec.ts"),
      `test("should be ignored", ()=>{});`
    );
  });

  afterAll(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("finds only .spec.ts files, recursing into subdirs but skipping node_modules", () => {
    const files = findSpecFiles(tmp).map((f) => path.basename(f)).sort();
    expect(files).toEqual(["a.spec.ts", "b.spec.ts"]);
  });

  it("returns empty array for a non-existent directory", () => {
    expect(findSpecFiles(path.join(tmp, "does-not-exist"))).toEqual([]);
  });

  it("discovers all tests with their derived types, sorted by testId", () => {
    const discovered = discoverAppTests(tmp);
    const titles = discovered.map((d) => d.title);
    expect(titles).toContain("a1");
    expect(titles).toContain("a2");
    expect(titles).toContain("b1");
    expect(discovered.find((d) => d.title === "a1")?.derivedType).toBe("smoke");
    expect(discovered.find((d) => d.title === "b1")?.derivedType).toBe("e2e");
    // caseName: describe title for a.spec.ts (shared by a1/a2); humanized
    // basename fallback for b.spec.ts (no describe).
    expect(discovered.find((d) => d.title === "a1")?.caseName).toBe("Case A");
    expect(discovered.find((d) => d.title === "a2")?.caseName).toBe("Case A");
    expect(discovered.find((d) => d.title === "b1")?.caseName).toBe("b");
    // node_modules test excluded
    expect(titles).not.toContain("should be ignored");
    // sorted
    const ids = discovered.map((d) => d.testId);
    expect([...ids].sort()).toEqual(ids);
  });
});

const TWO_TESTS = `import { test, expect } from '@playwright/test';

test('alpha', async ({ page }) => {
  await page.goto('/');
  expect(1 + 1).toBe(2); // math
});

test('beta', async ({ page }) => {
  const s = "a) tricky ( string with braces }";
  await page.click('button');
});
`;

describe("findTestBlock", () => {
  it("returns null for a title that is not present", () => {
    expect(findTestBlock(TWO_TESTS, "gamma")).toBeNull();
  });

  it("locates the first test block and includes trailing semicolon-less body", () => {
    const block = findTestBlock(TWO_TESTS, "alpha")!;
    expect(block).not.toBeNull();
    const slice = TWO_TESTS.slice(block.start, block.end);
    expect(slice.startsWith("test('alpha'")).toBe(true);
    expect(slice.trimEnd().endsWith("});")).toBe(true);
    // Should not swallow the next test.
    expect(slice).not.toContain("beta");
  });

  it("is not confused by parens/braces inside strings and comments", () => {
    const block = findTestBlock(TWO_TESTS, "beta")!;
    const slice = TWO_TESTS.slice(block.start, block.end);
    expect(slice).toContain("tricky");
    expect(slice.trimEnd().endsWith("});")).toBe(true);
  });
});

describe("removeTestByTitle", () => {
  it("returns null when the title is absent", () => {
    expect(removeTestByTitle(TWO_TESTS, "missing")).toBeNull();
  });

  it("removes one test and leaves the other intact", () => {
    const res = removeTestByTitle(TWO_TESTS, "alpha")!;
    expect(res.remaining).toBe(1);
    expect(parseTestTitles(res.source)).toEqual(["beta"]);
    expect(res.source).toContain("import { test, expect }");
    expect(res.source).not.toContain("'alpha'");
  });

  it("reports remaining 0 when removing the last test", () => {
    const single = `import { test } from '@playwright/test';\n\ntest('only', async () => {});\n`;
    const res = removeTestByTitle(single, "only")!;
    expect(res.remaining).toBe(0);
    expect(parseTestTitles(res.source)).toEqual([]);
  });

  it("does not leave 3+ consecutive blank lines behind", () => {
    const res = removeTestByTitle(TWO_TESTS, "alpha")!;
    expect(res.source).not.toMatch(/\n{3,}/);
  });

  it("round-trips: removing both titles one by one empties the file of tests", () => {
    const step1 = removeTestByTitle(TWO_TESTS, "beta")!;
    expect(step1.remaining).toBe(1);
    const step2 = removeTestByTitle(step1.source, "alpha")!;
    expect(step2.remaining).toBe(0);
  });

  it("integrity guard: refuses to rewrite if a body regex unbalances parens (does not corrupt)", () => {
    // The unmatched ')' inside the regex would make paren-matching cut short,
    // dropping (or keeping) the wrong number of tests. The guard must catch it.
    const tricky = `import { test, expect } from '@playwright/test';

test('regexy', async ({ page }) => {
  await expect(page.locator('x')).toHaveText(/a)b/);
});

test('next', async () => {});
`;
    const res = removeTestByTitle(tricky, "regexy");
    // Either a clean removal (remaining 1) or a refusal (null) — but never a
    // rewrite that changes the test count by anything other than exactly one.
    if (res !== null) {
      expect(res.remaining).toBe(1);
      expect(parseTestTitles(res.source)).toEqual(["next"]);
    }
  });
});

describe("renameTestInSource (#7)", () => {
  const SRC = `import { test, expect } from '@playwright/test';

test('alpha renders', async ({ page }) => {
  await expect(page).toHaveTitle(/x/);
});

test("beta works", async () => {
  expect(1).toBe(1);
});
`;

  it("rewrites only the target test's title literal", () => {
    const res = renameTestInSource(SRC, "alpha renders", "alpha shows chart");
    expect("source" in res).toBe(true);
    if ("source" in res) {
      expect(parseTestTitles(res.source).sort()).toEqual(
        ["alpha shows chart", "beta works"].sort()
      );
      // Body is untouched.
      expect(res.source).toContain("await expect(page).toHaveTitle(/x/);");
    }
  });

  it("preserves the original quote style (double quotes)", () => {
    const res = renameTestInSource(SRC, "beta works", "beta passes");
    if ("source" in res) {
      expect(res.source).toContain(`test("beta passes"`);
    } else {
      throw new Error("expected success");
    }
  });

  it("rejects a blank new title", () => {
    expect(renameTestInSource(SRC, "beta works", "   ")).toEqual({ error: "empty" });
  });

  it("rejects renaming to the same title", () => {
    expect(renameTestInSource(SRC, "beta works", "beta works")).toEqual({
      error: "unchanged",
    });
  });

  it("rejects a duplicate title already present in the file", () => {
    expect(renameTestInSource(SRC, "beta works", "alpha renders")).toEqual({
      error: "duplicate",
    });
  });

  it("reports not-found for an unknown old title", () => {
    expect(renameTestInSource(SRC, "does not exist", "whatever")).toEqual({
      error: "not-found",
    });
  });

  it("rejects titles containing newlines", () => {
    expect(renameTestInSource(SRC, "beta works", "line1\nline2")).toEqual({
      error: "invalid",
    });
  });

  it("escapes a delimiter character that appears in the new title", () => {
    const res = renameTestInSource(SRC, "beta works", `has a " quote`);
    if ("source" in res) {
      // The embedded double-quote must be escaped so the literal stays valid.
      expect(res.source).toContain('test("has a \\" quote"');
      // parseTestTitles returns the raw (still-escaped) literal content.
      expect(parseTestTitles(res.source)).toContain('has a \\" quote');
    } else {
      throw new Error("expected success");
    }
  });
});
