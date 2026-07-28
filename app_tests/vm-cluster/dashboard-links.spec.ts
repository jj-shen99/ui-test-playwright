/**
 * app_tests: VictoriaMetrics Cluster dashboard "Dashboard links" dropdown.
 *
 * Runs against a real, deployed Grafana (ServiceNow-hosted by default).
 * Verifies the items exposed by the dashboard-links control (the element carrying
 * data-testid="data-testid Dashboard link"). When a Grafana dashboard link is
 * configured as a dropdown, clicking the toggle reveals a menu whose entries each
 * also carry the "data-testid Dashboard link" test id.
 *
 * Base URL and dashboard path are configurable via env vars; defaults point at the
 * instance from the original request.
 *
 * @tags sanity
 */

import { test, expect, type Locator, type Page } from "@playwright/test";

// Dashboard: VictoriaMetrics Cluster (uid oS7Bi_0Wz)
const DASHBOARD_PATH =
  process.env.VM_DASHBOARD_PATH ||
  "/d/oS7Bi_0Wz/victoriametrics-cluster?orgId=1&from=now-3h&to=now&timezone=browser";

const DASHBOARD_LINK_TESTID = "data-testid Dashboard link";

// Expected items in the dropdown. Override via VM_EXPECTED_LINKS="a,b,c" if the
// dashboard's links change. Defaults to the single "Troubleshooting" link.
const EXPECTED_LINKS = (process.env.VM_EXPECTED_LINKS || "Troubleshooting")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

/** Returns the dashboard-link element(s) currently in the DOM. */
function dashboardLinks(page: Page): Locator {
  return page.locator(`[data-testid="${DASHBOARD_LINK_TESTID}"]`);
}

/**
 * Opens the dashboard-links dropdown if the control is a toggle button.
 * If the control is a plain anchor, it already represents the single item.
 */
async function openDropdownIfNeeded(page: Page): Promise<void> {
  // The control is the first dashboard-link element; when it's a toggle button,
  // opening it reveals the menu items (which share the same test id).
  // eslint-disable-next-line playwright/no-nth-methods -- the toggle is the single control
  const toggle = dashboardLinks(page).first();
  const tagName = await toggle.evaluate((el) => el.tagName.toLowerCase());
  if (tagName === "button") {
    await toggle.click();
    await toggle.waitFor({ state: "visible", timeout: 10_000 });
  }
}

test.describe("VictoriaMetrics Cluster — Dashboard links dropdown @sanity", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(DASHBOARD_PATH);
    // Wait for the dashboard sub-nav (where dashboard links live) to render.
    // eslint-disable-next-line playwright/no-nth-methods -- wait for the control (first link element) to render
    await dashboardLinks(page).first().waitFor({ state: "visible", timeout: 30_000 });
  });

  test("dashboard link control is visible", async ({ page }) => {
    // eslint-disable-next-line playwright/no-nth-methods -- asserts the control (first link element) renders
    await expect(dashboardLinks(page).first()).toBeVisible();
  });

  test("dropdown exposes at least one item", async ({ page }) => {
    await openDropdownIfNeeded(page);
    // beforeEach already waited for the control to be visible.
    expect(await dashboardLinks(page).count()).toBeGreaterThan(0);
  });

  test("every dropdown item has visible text and a valid href", async ({ page }) => {
    await openDropdownIfNeeded(page);

    const items = await dashboardLinks(page).all();
    expect(items.length).toBeGreaterThan(0);

    for (const [i, item] of items.entries()) {
      const text = (await item.innerText()).trim();
      expect(text.length, `link #${i} should have visible text`).toBeGreaterThan(0);

      // Anchor links should carry a non-empty href.
      const href = await item.getAttribute("href");
      if (href !== null) {
        expect(href.length, `link "${text}" should have a non-empty href`).toBeGreaterThan(0);
      }
    }
  });

  test("dropdown contains the expected items", async ({ page }) => {
    await openDropdownIfNeeded(page);

    const items = dashboardLinks(page);
    const labels = (await items.allInnerTexts()).map((t) => t.trim()).filter(Boolean);

    // Output the dropdown item names to the console for visibility in run logs.
    console.log(`Dashboard link dropdown items (${labels.length}):`);
    labels.forEach((label, i) => console.log(`  ${i + 1}. ${label}`));

    for (const expected of EXPECTED_LINKS) {
      expect(
        labels.some((l) => l.includes(expected)),
        `expected dropdown to contain "${expected}"; got [${labels.join(", ")}]`
      ).toBe(true);
    }
  });

  test("Troubleshooting link points at the VictoriaMetrics docs", async ({ page }) => {
    await openDropdownIfNeeded(page);

    // The toggle and the menu item can both match; take the first of the
    // filtered set (the link itself).
    // eslint-disable-next-line playwright/no-nth-methods -- toggle + menu item may both match
    const troubleshooting = dashboardLinks(page).filter({ hasText: "Troubleshooting" }).first();

    await expect(troubleshooting).toBeVisible();

    const href = await troubleshooting.getAttribute("href");
    expect(href).toContain("docs.victoriametrics.com");
    expect(href).toContain("troubleshooting");

    // External link should open in a new tab.
    await expect(troubleshooting).toHaveAttribute("target", "_blank");
  });
});
