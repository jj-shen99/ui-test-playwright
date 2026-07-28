// @ts-check
/**
 * ESLint flat config (ESLint 9).
 *
 * Scope is deliberately narrow: we parse all TypeScript so `eslint .` runs
 * clean across the repo, but we only enforce rules on Playwright test files.
 * Those rules operationalize the Engineering Notes from "Playwright, Actually"
 * (Ch. 1–6) so the guidance is enforced by a machine instead of a reviewer's
 * memory:
 *   - missing-playwright-await  (Ch. 5: an un-awaited web-first assertion
 *                                silently checks nothing — "the cheapest
 *                                bug-prevention in this book").
 *   - no-wait-for-timeout       (Ch. 4: fixed sleeps are a superstition).
 *   - no-networkidle            (Ch. 6: a live Grafana dashboard polls
 *                                continuously, so networkidle never settles).
 *   - no-focused-test / no-page-pause (Ch. 2/5: test.only silently skips the
 *                                suite; page.pause() is debug-only).
 * The Chapter 3 "locator ladder" rules are surfaced as warnings so they guide
 * without blocking CI.
 */

import tseslint from "typescript-eslint";
import playwright from "eslint-plugin-playwright";

/** Every Playwright test artifact: specs, setup projects, and page objects. */
const TEST_GLOBS = [
  "app_tests/**/*.spec.ts",
  "app_tests/**/*.setup.ts",
  "tests/**/*.spec.ts",
  "tests/**/*.setup.ts",
  "tests/pages/**/*.ts",
];

/** Spec/setup files only — the page object is the sanctioned home for raw
 * selectors (§7.4), so the locator-ladder warnings don't apply there. */
const SPEC_GLOBS = [
  "app_tests/**/*.spec.ts",
  "app_tests/**/*.setup.ts",
  "tests/**/*.spec.ts",
  "tests/**/*.setup.ts",
];

export default tseslint.config(
  {
    ignores: [
      "node_modules/**",
      "dist/**",
      "frontend/**",
      "playwright-report/**",
      "test-results/**",
      "**/*.d.ts",
    ],
  },

  // Parse all TypeScript so `eslint .` can walk the repo without choking on TS
  // syntax. No global rule set is enabled here on purpose — the repo-wide lint
  // stays focused on the Playwright guardrails below.
  {
    files: ["**/*.ts", "**/*.tsx"],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: { ecmaVersion: "latest", sourceType: "module" },
    },
  },

  // Playwright plugin's recommended baseline on all test artifacts.
  {
    ...playwright.configs["flat/recommended"],
    files: TEST_GLOBS,
  },

  // The book's Engineering Notes, tuned: hard errors for the flake-causing
  // anti-patterns, warnings for the locator-ladder smells.
  {
    files: TEST_GLOBS,
    rules: {
      "playwright/missing-playwright-await": "error",
      "playwright/no-wait-for-timeout": "error",
      "playwright/no-networkidle": "error",
      "playwright/no-focused-test": "error",
      "playwright/no-page-pause": "error",
      "playwright/no-useless-await": "error",

      "playwright/no-nth-methods": "warn",
      "playwright/no-force-option": "warn",
      "playwright/no-element-handle": "warn",
      "playwright/prefer-web-first-assertions": "warn",

      // The page object exposes assertion helpers (expectPanelRendered,
      // expectNoPanelErrors, expectPanelCount, …) that call expect() internally.
      // Teach expect-expect to count them so page-object-driven tests aren't
      // false-flagged as assertion-less.
      "playwright/expect-expect": [
        "warn",
        { assertFunctionNames: ["expect"], assertFunctionPatterns: ["\\bexpect"] },
      ],

      // These dashboard tests legitimately count elements and branch on the
      // rendered shape of Grafana's DOM; keep them non-blocking.
      "playwright/no-conditional-in-test": "off",
      "playwright/no-conditional-expect": "off",
      "playwright/no-skipped-test": "off",
    },
  },

  // Locator-ladder warnings only on specs — never on the page object, which is
  // the one deliberate place raw data-testid selectors are centralized.
  {
    files: SPEC_GLOBS,
    rules: {
      "playwright/no-raw-locators": "warn",
      "playwright/prefer-native-locators": "warn",
    },
  }
);
