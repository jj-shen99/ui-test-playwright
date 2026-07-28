/**
 * Auth setup for app_tests against a real, deployed Grafana.
 *
 * Two supported modes (checked in order):
 *
 * 1. **Already authenticated** — navigate to the target and, if it presents an
 *    authenticated session (no login form), persist the state to `auth-state.json`.
 *    This covers targets needing no interactive login, sessions authenticated by
 *    an upstream proxy, or a state pre-loaded via Playwright `storageState`.
 *
 * 2. **Form login** — if `VM_GRAFANA_USER` / `VM_GRAFANA_PASSWORD` are set, perform
 *    a standard Grafana username/password login and save the resulting state.
 *
 * If neither yields an authenticated session, the setup fails with actionable
 * guidance (e.g. capture an SSO session via `playwright codegen --save-storage`)
 * rather than letting downstream specs fail cryptically.
 */

import { test as setup, expect } from "@playwright/test";
import path from "path";
import fs from "fs";

const AUTH_STATE_PATH = path.join(__dirname, "auth-state.json");

/** Reduce any URL (possibly a deep dashboard link) to its scheme + host origin. */
function toOrigin(u: string): string {
  try {
    return new URL(u).origin;
  } catch {
    return u.replace(/\/+$/, "");
  }
}

// VM_GRAFANA_URL may be a full dashboard deep-link (with path + query). Auth and
// login navigation must target the Grafana *origin*, not that deep link.
const BASE_URL = toOrigin(
  process.env.VM_GRAFANA_URL ||
    "https://oodpcpconfig-prd-grafana-c003.ord100.service-now.com"
);

/** True when the page appears to be an authenticated Grafana session. */
async function isAuthenticated(page: import("@playwright/test").Page): Promise<boolean> {
  await page.goto(`${BASE_URL}/?orgId=1`, { waitUntil: "domcontentloaded" });
  // Grafana renders the mega-menu toggle only when logged in; the login form
  // exposes a password field. Use both as signals.
  const onLoginPage = /\/login/.test(page.url());
  if (onLoginPage) return false;
  // Password inputs expose no ARIA role, so a role/label locator can't target
  // this login-form signal (getByLabel(/password/i) also matches the
  // show-password toggle). Name-based is the correct, deliberate choice.
  // eslint-disable-next-line playwright/no-raw-locators -- password field has no role/label; see note
  const loginForm = page.locator('input[name="password"]');
  return !(await loginForm.isVisible({ timeout: 3_000 }).catch(() => false));
}

setup("authenticate with remote Grafana", async ({ page, browser }) => {
  // ── Mode 0: injected SSO session (#1) ──
  // The orchestrator may pre-write a captured storageState to AUTH_STATE_PATH and
  // set AUTH_STATE_INJECTED. Verify it works by loading it into a fresh context;
  // if the session is authenticated, keep the file for the chromium project.
  if (process.env.AUTH_STATE_INJECTED === "1" && fs.existsSync(AUTH_STATE_PATH)) {
    const ctx = await browser.newContext({ storageState: AUTH_STATE_PATH });
    try {
      const injectedPage = await ctx.newPage();
      await injectedPage.goto(`${BASE_URL}/?orgId=1`, { waitUntil: "domcontentloaded" });
      const onLogin = /\/login/.test(injectedPage.url());
      // eslint-disable-next-line playwright/no-raw-locators -- password field has no role/label (see isAuthenticated)
      const loginForm = injectedPage.locator('input[name="password"]');
      const authed = !onLogin && !(await loginForm.isVisible({ timeout: 3_000 }).catch(() => false));
      if (authed) {
        // Re-persist to normalize/refresh the state file, then we're done.
        await ctx.storageState({ path: AUTH_STATE_PATH });
        return;
      }
      console.warn(
        "Injected auth state did not yield an authenticated session; falling back to login."
      );
    } finally {
      await ctx.close();
    }
  }

  // ── Mode 1: already-authenticated session ──
  // Covers a previously-saved state (loaded via storageState upstream), a
  // target that requires no interactive login, or one authenticated by an
  // upstream proxy. If the session is good, persist it for the test projects.
  if (await isAuthenticated(page)) {
    await page.context().storageState({ path: AUTH_STATE_PATH });
    return;
  }
  // Not authenticated — fall through to attempt a fresh login.

  // ── Mode 2: scripted form login (only for non-SSO instances) ──
  const user = process.env.VM_GRAFANA_USER;
  const password = process.env.VM_GRAFANA_PASSWORD;

  if (user && password) {
    await page.goto(`${BASE_URL}/login`);
    // Grafana's login form: username is name="user", password is name="password".
    // Avoid getByLabel(/password/i) — it also matches the "Show password" toggle;
    // password inputs also expose no ARIA role. Name-based locators are the
    // correct, deliberate choice here rather than the usual role/label ladder.
    /* eslint-disable playwright/no-raw-locators -- login-form fields have no reliable role/label (see note) */
    await page.locator('input[name="user"]').fill(user);
    await page.locator('input[name="password"]').fill(password);
    await page.locator('button[type="submit"]').click();
    /* eslint-enable playwright/no-raw-locators */
    try {
      await page.waitForURL((url) => !url.pathname.includes("/login"), {
        timeout: 20_000,
      });
    } catch {
      // Still on /login after submitting — surface why instead of a raw timeout.
      const alertText = (
        await page
          .getByRole("alert")
          .or(page.getByTestId(/Alert/))
          // eslint-disable-next-line playwright/no-nth-methods -- surface the first alert message (there may be several)
          .first()
          .innerText()
          .catch(() => "")
      ).trim();
      throw new Error(
        [
          "Form login did not complete — still on the login page after 20s.",
          alertText ? `Grafana reported: "${alertText}".` : "",
          "",
          "Check that VM_GRAFANA_USER / VM_GRAFANA_PASSWORD are correct for this",
          "instance. If it is SSO-protected (ServiceNow, Okta, etc.), form login",
          "cannot work — capture a session once with:",
          "",
          `  npx playwright codegen "${BASE_URL}" \\`,
          `    --save-storage=app_tests/fixtures/auth-state.json`,
        ]
          .filter(Boolean)
          .join("\n")
      );
    }

    const skipButton = page.getByRole("button", { name: /skip/i });
    if (await skipButton.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await skipButton.click();
    }

    await expect(page).not.toHaveURL(/\/login/);
    await page.context().storageState({ path: AUTH_STATE_PATH });
    return;
  }

  // ── Neither path worked ──
  throw new Error(
    [
      "Could not authenticate with the remote Grafana.",
      "",
      "This instance appears to require SSO. Capture a session once with:",
      "",
      `  npx playwright codegen "${BASE_URL}" \\`,
      `    --save-storage=app_tests/fixtures/auth-state.json`,
      "",
      "…complete the SSO login in the opened browser, then close it. The saved",
      "state will be reused automatically on subsequent runs.",
      "",
      "For non-SSO instances, set VM_GRAFANA_USER and VM_GRAFANA_PASSWORD instead.",
    ].join("\n")
  );
});
