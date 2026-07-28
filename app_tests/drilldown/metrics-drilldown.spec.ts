/**
 * app_tests: Grafana Drilldown → Metrics (Metrics Drilldown app).
 *
 * Runs against a real, deployed Grafana (ServiceNow-hosted by default). Exercises
 * the "Drilldown → Metrics" experience backed by the `unified-api` datasource:
 *
 *   1. Open Grafana → Drilldown → Metrics.
 *   2. Confirm the active datasource is `unified-api`.
 *   3. Observe the metric count (the catalog exposes 2,600+ metrics).
 *   4. Metric cards render — each with a name heading and a sparkline preview
 *      (previews load via the datasource query endpoint — POST /api/ds/query on
 *      modern Grafana, or /api/v1/query_range on native Prometheus setups).
 *   5. The initial metric-list request (GET .../api/v1/label/__name__/values,
 *      typically via the datasource resources proxy) returns {"status":"success"}
 *      and there are no error banners.
 *
 * Everything is env-driven so the spec can point at any environment / datasource:
 *   - VM_GRAFANA_URL           base URL (see app_tests/README.md; used by config)
 *   - METRICS_DRILLDOWN_PATH   full path to the Metrics Drilldown view
 *   - METRICS_DS_UID           datasource uid carried in var-ds
 *   - METRICS_EXPECTED_DS      datasource NAME expected on screen (unified-api)
 *   - METRICS_MIN_COUNT        minimum metrics the catalog must return (2600)
 *
 * @tags regression
 */

import { test, expect, type Locator, type Page, type Response } from "@playwright/test";

// Datasource uid from the reference deep-link (var-ds). Override per environment.
const DATASOURCE_UID = process.env.METRICS_DS_UID || "af6sxvtc67caoc";

// Human-readable datasource name that should be shown as the active source.
const EXPECTED_DATASOURCE = process.env.METRICS_EXPECTED_DS || "unified-api";

// The metric catalog is expected to expose 2,600+ series names.
const MIN_METRIC_COUNT = Number(process.env.METRICS_MIN_COUNT || 2600);

// Metrics Drilldown app route (Grafana "Drilldown → Metrics"). The plugin id is
// `grafana-metricsdrilldown-app`; we pin the datasource via var-ds so the view
// opens against `unified-api`. Override wholesale with METRICS_DRILLDOWN_PATH.
const DRILLDOWN_PATH =
  process.env.METRICS_DRILLDOWN_PATH ||
  `/a/grafana-metricsdrilldown-app/drilldown?var-ds=${DATASOURCE_UID}`;

// Metric exercised by the detail / label-breakdown flow, and the label to break
// down by. METRICS_DETAIL_METRIC is optional: when unset the flow is
// datasource-agnostic and exercises whichever metric the catalog lists first
// (metric names vary per datasource, e.g. `threads_running`, `accumulateBusyTimeMs`).
const DETAIL_METRIC = process.env.METRICS_DETAIL_METRIC || "";
const BREAKDOWN_LABEL = process.env.METRICS_BREAKDOWN_LABEL || "instance";

// Optional selector escape hatches for deployments whose search box / card
// "Select" action don't match the role/placeholder defaults below.
const SEARCH_SELECTOR = process.env.METRICS_SEARCH_SELECTOR || "";
const SELECT_SELECTOR = process.env.METRICS_SELECT_SELECTOR || "";

// Grafana stable data-testids (treated as API — see app_tests/README.md).
const PANEL_HEADER_PREFIX = /^data-testid Panel header/;
const ALERT_ERROR_TESTID = "data-testid Alert error";
const PANEL_ERROR_TESTID = "data-testid Panel status error";

/** Extract a response's pathname, or "" when the URL can't be parsed. */
function pathnameOf(response: Response): string {
  try {
    return new URL(response.url()).pathname;
  } catch {
    return "";
  }
}

/**
 * The initial metric-list request. A path suffix is used so it matches whether
 * Grafana calls the datasource directly (`/api/v1/label/__name__/values`) or via
 * the datasource resources proxy
 * (`/api/datasources/uid/<uid>/resources/api/v1/label/__name__/values`).
 */
function isNameValuesResponse(response: Response): boolean {
  return /\/api\/v1\/label\/__name__\/values$/.test(pathnameOf(response));
}

/**
 * A metric-card preview data request. Modern Grafana routes datasource queries
 * through the unified `POST /api/ds/query`; native Prometheus datasources may
 * instead hit `/api/v1/query_range` (directly or via the resources proxy). Match
 * either so the spec is portable across deployments.
 */
function isPreviewQueryResponse(response: Response): boolean {
  const path = pathnameOf(response);
  return /\/api\/ds\/query$/.test(path) || /\/api\/v1\/query_range$/.test(path);
}

/** Matches the label-name list request (GET /api/v1/labels). */
function isLabelsResponse(response: Response): boolean {
  return /\/api\/v1\/labels$/.test(pathnameOf(response));
}

/** Matches a label-values request for ANY label (GET /api/v1/label/<name>/values). */
function isLabelValuesResponse(response: Response): boolean {
  return /\/api\/v1\/label\/[^/]+\/values$/.test(pathnameOf(response));
}

/**
 * True when a preview query references `metric`, checked across both transports:
 * the metric may live in the `/api/ds/query` POST body (queries[].expr) or in the
 * `/api/v1/query_range` URL/body. Matching the raw request text avoids coupling
 * to a specific request encoding.
 */
function queryReferencesMetric(response: Response, metric: string): boolean {
  if (!isPreviewQueryResponse(response)) return false;
  const haystack = `${response.url()}\n${response.request().postData() ?? ""}`;
  return haystack.includes(metric);
}

/** Metric cards: each metric renders as a VizPanel whose header is its name. */
function metricCards(page: Page): Locator {
  return page.getByTestId(PANEL_HEADER_PREFIX);
}

/**
 * Navigate to the Metrics Drilldown view and wait for a durable readiness
 * signal (the first metric card header) rather than a transient spinner or
 * network-idle. Best-effort: per-test assertions retry and surface a genuinely
 * stuck view.
 */
async function gotoDrilldown(page: Page): Promise<void> {
  await page.goto(DRILLDOWN_PATH);
  // eslint-disable-next-line playwright/no-nth-methods -- "at least one card rendered" gate
  const firstCard = metricCards(page).first();
  await firstCard.waitFor({ state: "visible", timeout: 45_000 }).catch(() => {
    /* assertions below retry and report the real failure */
  });
}

/** The Metrics Drilldown search / filter input. */
function searchBox(page: Page): Locator {
  if (SEARCH_SELECTOR) {
    // eslint-disable-next-line playwright/no-nth-methods -- env-provided escape hatch
    return page.locator(SEARCH_SELECTOR).first();
  }
  return (
    page
      .getByPlaceholder(/search metrics/i)
      .or(page.getByRole("searchbox"))
      .or(page.getByRole("textbox", { name: /search/i }))
      // eslint-disable-next-line playwright/no-nth-methods -- first matching search field
      .first()
  );
}

/** A breakdown-label option (tab / radio / button / text) for `label`. */
function labelOption(page: Page, label: string): Locator {
  const exact = new RegExp(`^${label}$`, "i");
  const loose = new RegExp(label, "i");
  return page
    .getByRole("radio", { name: loose })
    .or(page.getByRole("tab", { name: loose }))
    .or(page.getByRole("button", { name: exact }))
    .or(page.getByText(exact));
}

/**
 * Open Grafana → Drilldown → Metrics and select a metric card, returning the
 * name of the metric actually selected.
 *
 * When `DETAIL_METRIC` is configured the catalog is searched for that metric;
 * otherwise the flow is datasource-agnostic and selects whichever metric the
 * catalog lists first, reading its name from the card header. Either way it
 * clicks the card's "Select" action and waits on the metric-name heading as the
 * detail-view readiness signal.
 */
async function openMetricDetail(page: Page): Promise<string> {
  await gotoDrilldown(page);

  let card: Locator;
  let metric: string;

  if (DETAIL_METRIC) {
    // Narrow the catalog to the explicitly configured metric.
    const search = searchBox(page);
    await search.click().catch(() => {
      /* some builds focus the field automatically */
    });
    await search.fill(DETAIL_METRIC);
    // eslint-disable-next-line playwright/no-nth-methods -- the searched metric's card
    card = metricCards(page).filter({ hasText: DETAIL_METRIC }).first();
    await card.waitFor({ state: "visible", timeout: 30_000 });
    metric = DETAIL_METRIC;
  } else {
    // Datasource-agnostic: exercise whichever metric the catalog lists first and
    // read its name from the card header so assertions target the real metric.
    // eslint-disable-next-line playwright/no-nth-methods -- the first catalogued metric
    card = metricCards(page).first();
    await card.waitFor({ state: "visible", timeout: 30_000 });
    metric = (await card.innerText()).split("\n")[0].trim();
  }

  // Click the card's "Select" action. After narrowing (or with no filter) the
  // first Select button belongs to the target card (override via METRICS_SELECT_SELECTOR).
  const selectBtn = SELECT_SELECTOR
    ? // eslint-disable-next-line playwright/no-nth-methods -- env-provided escape hatch
      page.locator(SELECT_SELECTOR).first()
    : // eslint-disable-next-line playwright/no-nth-methods -- first Select after narrowing
      page.getByRole("button", { name: /^select$/i }).first();
  await selectBtn.click();

  // Detail-view readiness: the metric name is shown as a heading.
  await expect(
    // eslint-disable-next-line playwright/no-nth-methods -- the detail-view title
    page.getByRole("heading", { name: metric, exact: false }).first(),
    `expected the "${metric}" detail view to open`
  ).toBeVisible({ timeout: 30_000 });

  return metric;
}

test.describe("Drilldown Metrics — unified-api metric catalog @regression", () => {
  test("initial metric-list request returns success with the full catalog", async ({
    page,
  }) => {
    // Listen before navigating so the request isn't missed during app init.
    const responsePromise = page.waitForResponse(isNameValuesResponse, {
      timeout: 60_000,
    });

    await page.goto(DRILLDOWN_PATH);

    const response = await responsePromise;

    // Step 5: it is a GET to the label-values endpoint that succeeds.
    expect(response.request().method()).toBe("GET");
    expect(response.status()).toBe(200);

    const body = await response.json();
    // Prometheus/VictoriaMetrics shape: { status: "success", data: [...] }.
    expect(body?.status, `expected status "success"; got ${JSON.stringify(body?.status)}`).toBe(
      "success"
    );

    const data: unknown = Array.isArray(body) ? body : body?.data;
    expect(Array.isArray(data), "response should contain a data array").toBe(true);

    const metricNames = data as string[];
    console.log(
      `__name__ values → ${metricNames.length} metrics (e.g. ${JSON.stringify(
        metricNames.slice(0, 5)
      )})`
    );

    // Step 3 / Expected: the catalog exposes 2,600+ metrics.
    expect(
      metricNames.length,
      `expected at least ${MIN_METRIC_COUNT} metrics in the catalog`
    ).toBeGreaterThanOrEqual(MIN_METRIC_COUNT);
  });

  test("sparkline previews load via the datasource query endpoint", async ({ page }) => {
    const responsePromise = page.waitForResponse(isPreviewQueryResponse, {
      timeout: 60_000,
    });

    await page.goto(DRILLDOWN_PATH);

    const response = await responsePromise;

    // Preview queries are POST (/api/ds/query) or GET/POST (/api/v1/query_range).
    expect(["GET", "POST"]).toContain(response.request().method());
    expect(response.status()).toBe(200);

    // Tolerate both response shapes: Prometheus `{status:"success", ...}` and
    // the unified query API `{results:{...}}`. Only assert when a shape is known.
    const body = await response.json().catch(() => null);
    if (body && !Array.isArray(body)) {
      if (body.status !== undefined) {
        expect(body.status).toBe("success");
      } else if (body.results !== undefined) {
        expect(typeof body.results).toBe("object");
      }
    }
  });

  test("the active datasource is unified-api", async ({ page }) => {
    await gotoDrilldown(page);

    // The Drilldown datasource picker surfaces the source name on screen.
    // eslint-disable-next-line playwright/no-nth-methods -- name may appear in picker + breadcrumb; any visible instance confirms it
    const dsLabel = page.getByText(EXPECTED_DATASOURCE, { exact: false }).first();
    await expect(
      dsLabel,
      `expected the "${EXPECTED_DATASOURCE}" datasource to be shown`
    ).toBeVisible({ timeout: 30_000 });
  });

  test("metric cards render with a name heading and a sparkline", async ({ page }) => {
    await gotoDrilldown(page);

    const cards = metricCards(page);
    expect(
      await cards.count(),
      "expected at least one metric card to render"
    ).toBeGreaterThan(0);

    // Each card's header (the metric name) should carry visible text.
    // eslint-disable-next-line playwright/no-nth-methods -- inspect the first rendered card as representative
    const firstHeader = cards.first();
    await expect(firstHeader).toBeVisible({ timeout: 30_000 });
    expect((await firstHeader.innerText()).trim().length).toBeGreaterThan(0);

    // Sparklines render as uPlot <canvas> elements; at least one must be drawn.
    // A <canvas> has no role/testid, so a raw locator is the only option here.
    // eslint-disable-next-line playwright/no-raw-locators -- <canvas> exposes no role/testid
    const sparklines = page.locator("canvas");
    await expect(
      sparklines,
      "expected at least one sparkline canvas to render"
    ).not.toHaveCount(0, { timeout: 30_000 });
  });

  test("no error banners are shown", async ({ page }) => {
    await gotoDrilldown(page);

    // Neither an app-level error alert nor a panel error state should be present.
    await expect(
      page.getByTestId(ALERT_ERROR_TESTID),
      "an error banner is visible"
    ).toHaveCount(0, { timeout: 15_000 });
    await expect(
      page.getByTestId(PANEL_ERROR_TESTID),
      "a panel is in an error state"
    ).toHaveCount(0, { timeout: 15_000 });
  });
});

test.describe("Drilldown Metrics — metric detail & label breakdown @regression", () => {
  test("selecting a metric card opens a detail view with a time-series graph", async ({
    page,
  }) => {
    await openMetricDetail(page);

    // Step 3: the detail view renders a time-series graph (uPlot <canvas>).
    // eslint-disable-next-line playwright/no-raw-locators -- <canvas> exposes no role/testid
    const graphs = page.locator("canvas");
    await expect(
      graphs,
      "expected a time-series graph in the metric detail view"
    ).not.toHaveCount(0, { timeout: 30_000 });

    // Expected: data loads without errors.
    await expect(
      page.getByTestId(ALERT_ERROR_TESTID),
      "an error banner is visible in the detail view"
    ).toHaveCount(0, { timeout: 10_000 });
    await expect(
      page.getByTestId(PANEL_ERROR_TESTID),
      "a detail panel is in an error state"
    ).toHaveCount(0, { timeout: 10_000 });
  });

  test("the detail view exposes label breakdown options", async ({ page }) => {
    await openMetricDetail(page);

    // Step 3/4: a "Breakdown" view lists labels to break the metric down by.
    // Labels are populated via /api/v1/labels (or /api/v1/series); opening the
    // tab triggers that fetch.
    const labelsPromise = page
      .waitForResponse((r) => isLabelsResponse(r) || isLabelValuesResponse(r), {
        timeout: 45_000,
      })
      .catch(() => null);

    const breakdownTab = page
      .getByRole("tab", { name: /breakdown/i })
      .or(page.getByRole("link", { name: /breakdown/i }))
      // eslint-disable-next-line playwright/no-nth-methods -- the Breakdown tab
      .first();
    await breakdownTab.click().catch(() => {
      /* breakdown may already be the default view */
    });

    // The target label is offered as a breakdown option.
    await expect(
      // eslint-disable-next-line playwright/no-nth-methods -- any surfaced instance of the label option
      labelOption(page, BREAKDOWN_LABEL).first(),
      `expected a "${BREAKDOWN_LABEL}" label breakdown option`
    ).toBeVisible({ timeout: 30_000 });

    // A label-name/values request should have populated the options.
    expect(
      await labelsPromise,
      "expected a /api/v1/labels or /api/v1/label/<name>/values request"
    ).not.toBeNull();
  });

  test("selecting a label shows per-value series via queries referencing the metric", async ({
    page,
  }) => {
    const metric = await openMetricDetail(page);

    // Step 5: capture a preview query that references the selected metric,
    // triggered by drilling into the label. Listen before interacting.
    const queryPromise = page
      .waitForResponse(
        (r) => queryReferencesMetric(r, metric) && r.status() === 200,
        { timeout: 60_000 }
      )
      .catch(() => null);

    // Open the Breakdown view and pick the target label.
    const breakdownTab = page
      .getByRole("tab", { name: /breakdown/i })
      .or(page.getByRole("link", { name: /breakdown/i }))
      // eslint-disable-next-line playwright/no-nth-methods -- the Breakdown tab
      .first();
    await breakdownTab.click().catch(() => {
      /* breakdown may already be the default view */
    });

    // eslint-disable-next-line playwright/no-nth-methods -- the surfaced label option
    await labelOption(page, BREAKDOWN_LABEL).first().click();

    // Step 4 outcome: per-value time-series render (one graph per label value).
    // eslint-disable-next-line playwright/no-raw-locators -- <canvas> exposes no role/testid
    const series = page.locator("canvas");
    await expect(
      series,
      "expected per-value time-series after selecting the label"
    ).not.toHaveCount(0, { timeout: 30_000 });

    // Step 5 assertion: a query_range / ds-query call referencing the metric fired.
    const queryResponse = await queryPromise;
    expect(
      queryResponse,
      `expected a query_range/ds-query call referencing "${metric}"`
    ).not.toBeNull();

    // Expected: all data loads without errors.
    await expect(
      page.getByTestId(ALERT_ERROR_TESTID),
      "an error banner is visible during the breakdown"
    ).toHaveCount(0, { timeout: 10_000 });
  });
});
