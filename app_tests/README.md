# app_tests

End-to-end tests that run against **real, deployed applications** (e.g. the
ServiceNow-hosted VictoriaMetrics Grafana), separate from the deterministic local
stack covered by the repo-root `tests/` suite.

These tests have their own Playwright config (`app_tests/playwright.config.ts`) so
they never run against the local `docker compose` environment by accident.

## Layout

```
app_tests/
├── playwright.config.ts        # config for real-app tests (own baseURL, auth)
├── fixtures/
│   └── auth.setup.ts           # remote auth (reuse session or scripted login)
├── uploaded/                   # specs uploaded via the Test Catalog UI (gitignored)
├── vm-cluster/
│   ├── dashboard-links.spec.ts      # dashboard-links dropdown
│   ├── variable-dropdown.spec.ts    # template-variable picker
│   └── label-values-request.spec.ts # label_values() network contract
└── drilldown/
    └── metrics-drilldown.spec.ts    # Drilldown → Metrics: catalog + metric detail & label breakdown
```

Element location is centralized in the `GrafanaDashboardPage` page object
(`tests/pages/grafana-dashboard.page.ts`) — see the **Selector contract** below.

### Uploading a test from the UI

The **Test Catalog** page (`/tests`) has an **Upload Test** button. Pick a
Playwright `.spec.ts` file (optionally choosing a type); it is validated
(must contain at least one `test()`), written to `app_tests/uploaded/`, and
immediately appears in the catalog. Uploaded files are runtime artifacts and
are gitignored by default — commit them manually if you want them tracked.

## Configuration

| Env var              | Default                                                                 | Purpose                                    |
|----------------------|-------------------------------------------------------------------------|--------------------------------------------|
| `VM_GRAFANA_URL`     | `https://oodpcpconfig-prd-grafana-c003.ord100.service-now.com`          | Base URL of the target Grafana             |
| `VM_DASHBOARD_PATH`  | `/d/oS7Bi_0Wz/victoriametrics-cluster?orgId=1&from=now-3h&to=now&...`   | Dashboard path under test                  |
| `VM_EXPECTED_LINKS`  | `Troubleshooting`                                                       | Comma-separated labels expected in dropdown|
| `VM_GRAFANA_USER`    | *(unset)*                                                               | Username for scripted (non-SSO) login      |
| `VM_GRAFANA_PASSWORD`| *(unset)*                                                               | Password for scripted (non-SSO) login      |
| `METRICS_DRILLDOWN_PATH` | `/a/grafana-metricsdrilldown-app/drilldown?var-ds=<uid>`            | Metrics Drilldown view path                |
| `METRICS_DS_UID`     | `af6sxvtc67caoc`                                                        | Datasource uid carried in `var-ds`         |
| `METRICS_EXPECTED_DS`| `unified-api`                                                          | Datasource name expected on screen         |
| `METRICS_MIN_COUNT`  | `2600`                                                                  | Minimum metrics the catalog must return    |
| `METRICS_DETAIL_METRIC`  | *(unset → first catalogued metric)*                                 | Metric used for the detail / breakdown flow (auto-picked when unset, so it works against any datasource)|
| `METRICS_BREAKDOWN_LABEL`| `instance`                                                          | Label to break the metric down by          |
| `METRICS_SEARCH_SELECTOR`| *(unset)*                                                           | Override for the Drilldown search input    |
| `METRICS_SELECT_SELECTOR`| *(unset)*                                                           | Override for a metric card's "Select" action|

You can also drop an `app_tests/.env` file to set these locally (git-ignored).

## Selector contract (`data-testid`)

These tests locate elements through Grafana's stable `data-testid` attributes
rather than CSS classes or Emotion hashes, which change between builds. **Treat
these test ids as API**: Grafana emits them via `@grafana/e2e-selectors`, and
renaming one upstream (or a major Grafana upgrade) is a *breaking change* for
this suite. The canonical list lives in the `TESTID` map in
`tests/pages/grafana-dashboard.page.ts`; this table mirrors it for reference.

Prefer `page.getByTestId(...)` over a raw `[data-testid=...]` locator — it reads
as intent and keeps the suite on the higher rungs of the locator ladder.

| Purpose                     | `data-testid` value (Grafana 11.x)                     | Used by                          |
|-----------------------------|--------------------------------------------------------|----------------------------------|
| Dashboard shell             | `data-testid Dashboard`                                | page object (load signal)        |
| Template-variables sub-nav  | `data-testid Dashboard template variables submenu`     | page object (load signal)        |
| Panel header (by title)     | `data-testid Panel header <title>`                     | page object (`panel`, `allPanels`)|
| Panel error state           | `data-testid Panel status error`                       | page object (`expectPanelError`) |
| Panel loading bar           | `data-testid Panel loading bar`                        | page object (`waitForPanelDataLoad`)|
| Viz legend series           | `data-testid VizLegend series <name>`                  | page object (legend count/labels)|
| Named template variable     | `data-testid variable-<name>`                          | page object (`variableDropdown`) |
| Generic variable picker     | `data-testid template variable`                        | vm-cluster dropdown specs        |
| Dashboard link control/item | `data-testid Dashboard link`                           | `dashboard-links.spec.ts`        |
| App-level error banner      | `data-testid Alert error`                              | `metrics-drilldown.spec.ts`      |

Only **one** CSS-class coupling remains, gated and documented: a fallback for
the viz legend (`[class*="LegendItem"]`) used *only* when the per-series testid
is absent. Revisit it on each Grafana upgrade.

The `vm-cluster/*` specs expose their selectors as env overrides
(`VM_DROPDOWN_SELECTOR`, `VM_DROPDOWN_OPTION_SELECTOR`) so a Grafana version with
different ids can be accommodated without editing the specs.

## Authentication

The target instance is SSO-protected, so credentials usually can't be scripted.
Capture a browser session **once**:

```bash
npx playwright codegen "https://oodpcpconfig-prd-grafana-c003.ord100.service-now.com" \
  --save-storage=app_tests/fixtures/auth-state.json
```

Complete the SSO login in the opened browser, then close it. The saved
`auth-state.json` is reused automatically (and re-validated) on every run.

For a non-SSO instance you can instead set `VM_GRAFANA_USER` / `VM_GRAFANA_PASSWORD`
and the auth setup will perform a standard Grafana login.

## Running

```bash
# All app_tests
npx playwright test --config app_tests/playwright.config.ts

# Just the VM cluster dashboard-links spec, headed
npx playwright test --config app_tests/playwright.config.ts \
  app_tests/vm-cluster/dashboard-links.spec.ts --headed

# Point at a different environment / dashboard
VM_GRAFANA_URL="https://my-grafana.example.com" \
VM_DASHBOARD_PATH="/d/abc123/my-dashboard?orgId=1" \
VM_EXPECTED_LINKS="Troubleshooting,Runbook" \
  npx playwright test --config app_tests/playwright.config.ts
```

## What `dashboard-links.spec.ts` verifies

The target element carries `data-testid="data-testid Dashboard link"` — Grafana's
dashboard-link control. The spec:

1. **control is visible** — the dashboard-links control renders in the sub-nav.
2. **dropdown exposes at least one item** — opens the dropdown (when the control is
   a toggle button) and asserts it is non-empty.
3. **every item has text and a valid href** — each entry has a label and, for
   anchors, a non-empty `href`.
4. **contains the expected items** — the labels in `VM_EXPECTED_LINKS` are present.
5. **Troubleshooting link** — points at `docs.victoriametrics.com/.../troubleshooting`
   and opens in a new tab (`target="_blank"`).

The spec auto-detects whether the control is an expandable dropdown (`<button>`) or a
plain inline link (`<a>`), so it works with either Grafana rendering.
