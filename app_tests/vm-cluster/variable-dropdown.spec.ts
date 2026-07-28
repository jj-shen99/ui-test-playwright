/**
 * VictoriaMetrics Cluster dashboard — dropdown control test.
 *
 * Targets a template-variable dropdown on the VictoriaMetrics Cluster dashboard
 * (the control originally reported as class="css-9il6na"). The dashboard's URL
 * carries several template variables (var-ds, var-job, var-instance, var-adhoc,
 * …), each rendered as one of these dropdowns.
 *
 * Uses Grafana's stable selector `data-testid="data-testid template variable"`
 * rather than the build-specific Emotion class. Override with
 * VM_DROPDOWN_SELECTOR if needed. Base URL/auth come from env; see
 * app_tests/README.md.
 *
 * @tags sanity
 */

import { test, expect, type Locator, type Page } from "@playwright/test";

// Full deep-link from the original request; override via VM_DASHBOARD_PATH.
const DASHBOARD_PATH =
  process.env.VM_DASHBOARD_PATH ||
  "/d/oS7Bi_0Wz/victoriametrics-cluster?orgId=1&from=now-3h&to=now&timezone=browser" +
    "&var-ds=PF5F44F14002E23D7&var-job=$__all&var-job_insert=$__all" +
    "&var-job_select=$__all&var-job_storage=$__all&var-instance=$__all" +
    "&var-adhoc=k8s_namespace_name%7C%3D%7Coodp-op-config" +
    "&var-adhoc=k8s_cluster%7C%3D%7Cc003.aus";

// The dropdown control under test. Grafana tags every template-variable picker
// with this stable data-testid; override via VM_DROPDOWN_SELECTOR if needed.
const DROPDOWN_SELECTOR =
  process.env.VM_DROPDOWN_SELECTOR || '[data-testid="data-testid template variable"]';

// Options rendered once the dropdown is open. Grafana renders these in a portal
// as ARIA options/menu items; override via VM_DROPDOWN_OPTION_SELECTOR if needed.
const OPTION_SELECTOR =
  process.env.VM_DROPDOWN_OPTION_SELECTOR ||
  '[role="option"], [role="menuitem"], [aria-label="Select options menu"] [role="option"]';

/**
 * A representative template-variable picker. The VM Cluster dashboard renders
 * several equivalent pickers (var-ds, var-job, var-instance, …), all sharing
 * this test id; this suite exercises the picker behaviour on a representative
 * one, so `.first()` is an intentional, reviewed choice rather than silenced
 * ambiguity.
 */
function dropdown(page: Page): Locator {
  // eslint-disable-next-line playwright/no-nth-methods -- representative of N equivalent pickers (see above)
  return page.locator(DROPDOWN_SELECTOR).first();
}

/** The options exposed after the dropdown is opened. */
function options(page: Page): Locator {
  return page.locator(OPTION_SELECTOR);
}

/** Open the dropdown and wait for its options to render. */
async function openDropdown(page: Page): Promise<void> {
  await dropdown(page).click();
  // Visibility can only be asserted on a single element, so `.first()` here
  // means "the option list is up" — a genuine at-least-one-visible gate.
  // eslint-disable-next-line playwright/no-nth-methods -- "at least one option visible" gate
  await options(page).first().waitFor({ state: "visible", timeout: 10_000 });
}

test.describe("VictoriaMetrics Cluster — template variable dropdown @sanity", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(DASHBOARD_PATH);
    // Wait for the dropdown control itself to render.
    await dropdown(page).waitFor({ state: "visible", timeout: 30_000 });
  });

  test("dropdown control is visible", async ({ page }) => {
    await expect(dropdown(page)).toBeVisible();
  });

  test("dropdown opens and exposes at least one option", async ({ page }) => {
    await openDropdown(page);
    // openDropdown already waited for the first option to be visible.
    expect(await options(page).count()).toBeGreaterThan(0);
  });

  test("dropdown option names are logged to the console", async ({ page }) => {
    await openDropdown(page);

    const labels = (await options(page).allInnerTexts())
      .map((t) => t.trim())
      .filter(Boolean);

    console.log(`Template variable dropdown options (${labels.length}):`);
    labels.forEach((label, i) => console.log(`  ${i + 1}. ${label}`));

    expect(labels.length).toBeGreaterThan(0);
  });

  test("every option has visible, non-empty text", async ({ page }) => {
    await openDropdown(page);

    const labels = (await options(page).allInnerTexts()).map((t) => t.trim());
    expect(labels.length).toBeGreaterThan(0);
    labels.forEach((text, i) =>
      expect(text.length, `option #${i} should have visible text`).toBeGreaterThan(0)
    );
  });
});
