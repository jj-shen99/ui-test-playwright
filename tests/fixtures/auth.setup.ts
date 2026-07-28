/**
 * Auth setup: logs into Grafana once and saves auth state to disk (§7.4).
 * All other tests reuse this state — no per-test login UI interaction.
 */

import { test as setup, expect } from "@playwright/test";
import path from "path";

const AUTH_STATE_PATH = path.join(__dirname, "auth-state.json");

setup("authenticate with Grafana", async ({ page }) => {
  const grafanaUrl = process.env.GRAFANA_URL || "http://localhost:3000";
  const user = process.env.GRAFANA_USER || "admin";
  const password = process.env.GRAFANA_PASSWORD || "admin";

  await page.goto(`${grafanaUrl}/login`);

  // Fill login form
  await page.getByLabel("Email or username").fill(user);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: /log in/i }).click();

  // Wait for navigation to complete — Grafana redirects to home after login
  await page.waitForURL((url) => !url.pathname.includes("/login"), {
    timeout: 15_000,
  });

  // Handle the "Change password" prompt that appears on first login
  const skipButton = page.getByRole("button", { name: /skip/i });
  if (await skipButton.isVisible({ timeout: 3000 }).catch(() => false)) {
    await skipButton.click();
  }

  // Verify we are logged in
  await expect(page).not.toHaveURL(/\/login/);

  // Save auth state for reuse
  await page.context().storageState({ path: AUTH_STATE_PATH });
});
