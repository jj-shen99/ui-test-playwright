/**
 * Template-variable label_values() network contract test.
 *
 * Scenario: a dashboard defines a template variable as
 * `label_values(<metric>, instance)`. When the dashboard loads (or the dropdown
 * is opened) Grafana resolves the variable by calling the datasource's
 * label-values endpoint with a scoped `match[]` selector.
 *
 * This spec verifies the dashboard-agnostic contract:
 *   1. the `instance` dropdown populates, and
 *   2. the underlying request is GET .../api/v1/label/instance/values carrying a
 *      `match[]` selector, returning HTTP 200 and a non-empty data array.
 *
 * The *specific* metric in the `match[]` selector is dashboard-defined (e.g. one
 * dashboard uses `threads_running`, another `vm_app_version`), so it is NOT
 * asserted by default — the observed selector is logged instead. Set
 * VM_LABEL_METRIC to turn on a strict check that the selector includes a
 * particular metric.
 *
 * Everything is env-driven so it can point at whichever dashboard hosts the
 * variable. Point VM_LABEL_DASHBOARD_PATH at that dashboard; override
 * VM_LABEL_NAME if the label differs. Base URL/auth come from env — see
 * app_tests/README.md.
 *
 * @tags sanity
 */

import { test, expect, type Locator, type Page, type Response } from "@playwright/test";

// The label being resolved, i.e. label_values(<metric>, <LABEL_NAME>).
const LABEL_NAME = process.env.VM_LABEL_NAME || "instance";
// Optional strict check: when set, the match[] selector must include this
// metric. Left unset by default because the metric is dashboard-specific and
// hard-coding one produces false failures against other dashboards.
const EXPECTED_METRIC = process.env.VM_LABEL_METRIC?.trim() || "";

// Dashboard hosting a label_values(<metric>, instance) variable. Defaults to
// the VictoriaMetrics Cluster deep-link used by the sibling specs; override with
// a dashboard that actually defines this variable.
const DASHBOARD_PATH =
  process.env.VM_LABEL_DASHBOARD_PATH ||
  process.env.VM_DASHBOARD_PATH ||
  "/d/oS7Bi_0Wz/victoriametrics-cluster?orgId=1&from=now-3h&to=now&timezone=browser" +
    "&var-ds=PF5F44F14002E23D7&var-instance=$__all";

// The template-variable dropdown control (stable Grafana data-testid).
const DROPDOWN_SELECTOR =
  process.env.VM_DROPDOWN_SELECTOR || '[data-testid="data-testid template variable"]';

const OPTION_SELECTOR =
  process.env.VM_DROPDOWN_OPTION_SELECTOR ||
  '[role="option"], [role="menuitem"], [aria-label="Select options menu"] [role="option"]';

/** Escape a string for safe use inside a RegExp. */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Matches the label-values request for the configured label. Uses a path suffix
 * so it works whether Grafana calls the datasource directly
 * (`/api/v1/label/instance/values`) or via its proxy
 * (`/api/datasources/proxy/<uid>/api/v1/label/instance/values`). The `match[]`
 * contents are asserted in the test body (not the predicate) so a request with
 * an unexpected selector fails loudly instead of timing out.
 */
function isLabelValuesResponse(response: Response): boolean {
  let pathname: string;
  try {
    pathname = new URL(response.url()).pathname;
  } catch {
    return false;
  }
  return new RegExp(`/api/v1/label/${escapeRegExp(LABEL_NAME)}/values$`).test(pathname);
}

/**
 * A representative template-variable picker. Several equivalent pickers share
 * this test id; `.first()` is an intentional, reviewed choice (see the sibling
 * variable-dropdown spec) rather than silenced ambiguity.
 */
function dropdown(page: Page): Locator {
  // eslint-disable-next-line playwright/no-nth-methods -- representative of N equivalent pickers
  return page.locator(DROPDOWN_SELECTOR).first();
}

/** Options rendered once the dropdown is opened. */
function options(page: Page): Locator {
  return page.locator(OPTION_SELECTOR);
}

/** Open the dropdown and wait for its options to render (best effort). */
async function openDropdown(page: Page): Promise<void> {
  await dropdown(page).click();
  // Visibility asserts on a single element, so `.first()` here is a genuine
  // "at least one option is visible" gate.
  // eslint-disable-next-line playwright/no-nth-methods -- "at least one option visible" gate
  await options(page).first().waitFor({ state: "visible", timeout: 10_000 });
}

// The describe title is the "test case" name shown in the /tests catalog, and
// each test() below is one of its child tests. Titles are static string
// literals (not template literals) so the catalog's static discovery can read
// them; the label/metric behaviour is still env-configurable above.
test.describe("Instance variable resolves via a label_values(instance) query @sanity", () => {
  test("instance dropdown populates from the label_values query", async ({ page }) => {
    await page.goto(DASHBOARD_PATH);
    await dropdown(page).waitFor({ state: "visible", timeout: 30_000 });

    await openDropdown(page);

    // openDropdown already waited for the first option to be visible.
    expect(
      await options(page).count(),
      "the dropdown should populate with at least one option"
    ).toBeGreaterThan(0);
  });

  test("label values request returns HTTP 200 with a non-empty data array", async ({
    page,
  }) => {
    // Start listening before navigation so we catch the request whether it fires
    // during dashboard init or when the dropdown is opened.
    const responsePromise = page.waitForResponse(isLabelValuesResponse, {
      timeout: 45_000,
    });

    await page.goto(DASHBOARD_PATH);
    await dropdown(page).waitFor({ state: "visible", timeout: 30_000 });
    // Opening the dropdown forces Grafana to (re)issue the label_values query if
    // it wasn't triggered on load; ignore failures since it may already be open.
    await openDropdown(page).catch(() => {
      /* options may already be cached/visible */
    });

    const response = await responsePromise;

    // Step 3: it is a GET to the label-values endpoint carrying a match[]
    // selector (Grafana scopes label_values(<metric>, <label>) with match[]).
    expect(response.request().method()).toBe("GET");

    const matches = new URL(response.url()).searchParams.getAll("match[]");
    expect(
      matches.length,
      "the label_values request should carry a match[] selector"
    ).toBeGreaterThan(0);

    // The specific metric is dashboard-defined; only enforce it when the
    // operator pins one via VM_LABEL_METRIC. Otherwise just report what we saw.
    if (EXPECTED_METRIC) {
      expect(
        matches.some((m) => m.includes(EXPECTED_METRIC)),
        `match[] should include the metric "${EXPECTED_METRIC}"; got ${JSON.stringify(matches)}`
      ).toBe(true);
    }

    // Step 4: HTTP 200 with a non-empty data array.
    expect(response.status()).toBe(200);

    const body = await response.json();
    // Prometheus/VictoriaMetrics shape: { status: "success", data: [...] };
    // fall back to a bare array in case the datasource returns one directly.
    const data = Array.isArray(body) ? body : body?.data;
    expect(Array.isArray(data), "response should contain a data array").toBe(true);
    expect(data.length, "the data array should be non-empty").toBeGreaterThan(0);

    console.log(
      `label_values(${LABEL_NAME}) match[]=${JSON.stringify(matches)} → ${data.length} ` +
        `value(s), e.g. ${JSON.stringify(data.slice(0, 5))}`
    );
  });
});
