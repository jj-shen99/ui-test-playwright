/**
 * Playwright config for **app_tests** — tests that run against real, deployed
 * applications (e.g. the ServiceNow-hosted VictoriaMetrics Grafana), as opposed
 * to the deterministic local stack covered by the root-level `tests/` suite.
 *
 * Base URL and credentials come from env vars so the same specs can point at any
 * environment. See app_tests/README.md for usage.
 */

import { defineConfig, devices } from "@playwright/test";
import dotenv from "dotenv";
import path from "path";

// Load repo-root .env, then an optional app_tests/.env override.
dotenv.config();
dotenv.config({ path: path.join(__dirname, ".env"), override: true });

const BASE_URL =
  process.env.VM_GRAFANA_URL ||
  "https://oodpcpconfig-prd-grafana-c003.ord100.service-now.com";

// Per-run environment overrides (#15). The orchestrator sets these from the
// trigger form; when absent, Playwright's Desktop Chrome defaults apply.
const runViewport =
  process.env.RUN_VIEWPORT_WIDTH && process.env.RUN_VIEWPORT_HEIGHT
    ? {
        width: Number(process.env.RUN_VIEWPORT_WIDTH),
        height: Number(process.env.RUN_VIEWPORT_HEIGHT),
      }
    : undefined;
const runTimezone = process.env.RUN_TIMEZONE || undefined;

export default defineConfig({
  testDir: ".",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 4 : undefined,
  reporter: [
    ["html", { open: "never", outputFolder: "playwright-report" }],
    ["list"],
    // When run by the orchestrator (STORE_RESULTS=true), persist per-test
    // results + artifacts so the /results page has data. The reporter lives at
    // the repo root; resolve it relative to this config's directory.
    ...(process.env.STORE_RESULTS
      ? ([[path.resolve(__dirname, "../tests/fixtures/store-reporter.ts")]] as [[string]])
      : []),
  ],
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    video: "retain-on-failure",
    screenshot: "only-on-failure",
    actionTimeout: 15_000,
    navigationTimeout: 45_000,
    // NOTE: storageState is intentionally NOT set globally. The auth-setup
    // project must start with a clean session and *create* the state file;
    // only the chromium project reads it (after auth-setup runs). Setting it
    // here would make Playwright read a not-yet-created file and fail with
    // ENOENT before auth-setup can run.
  },
  projects: [
    {
      name: "auth-setup",
      testMatch: /auth\.setup\.ts/,
    },
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        storageState: path.join(__dirname, "fixtures", "auth-state.json"),
        // Per-run overrides (#15) win over the Desktop Chrome defaults.
        ...(runViewport ? { viewport: runViewport } : {}),
        ...(runTimezone ? { timezoneId: runTimezone } : {}),
      },
      dependencies: ["auth-setup"],
    },
  ],
});
