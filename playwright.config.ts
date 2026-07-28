import { defineConfig, devices } from "@playwright/test";
import dotenv from "dotenv";

dotenv.config();

const GRAFANA_URL = process.env.GRAFANA_URL || "http://localhost:3000";

export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 4 : undefined,
  reporter: [
    ["html", { open: "never" }],
    ["json", { outputFile: "test-results/results.json" }],
    ...(process.env.STORE_RESULTS
      ? ([["./tests/fixtures/store-reporter.ts"]] as [[string]])
      : []),
  ],
  use: {
    baseURL: GRAFANA_URL,
    trace: "retain-on-failure",
    video: "retain-on-failure",
    screenshot: "only-on-failure",
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    storageState: "tests/fixtures/auth-state.json",
  },
  projects: [
    {
      name: "auth-setup",
      testMatch: /auth\.setup\.ts/,
      use: { storageState: undefined },
    },
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
      dependencies: ["auth-setup"],
    },
  ],
  // Absolute time range for deterministic tests (§7.4)
  // Seed window: 2025-01-01T00:00:00Z to 2025-01-01T06:00:00Z
  // Epoch ms: from=1735689600000 to=1735711200000
});
