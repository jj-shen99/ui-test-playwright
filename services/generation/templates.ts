/**
 * Test template emitter (FR-2).
 * Generates Playwright spec code from parsed dashboard models.
 */

import type { ParsedDashboard, ParsedPanel, ParsedVariable } from "./parser";
import crypto from "crypto";

/** Generate all spec file contents for a dashboard */
export function generateSpecs(
  dashboard: ParsedDashboard,
  seedInstanceCount: number = 3
): GeneratedFile[] {
  const files: GeneratedFile[] = [];
  const dashHash = crypto
    .createHash("md5")
    .update(JSON.stringify(dashboard))
    .digest("hex")
    .slice(0, 8);

  // Per-panel specs
  for (const panel of dashboard.panels) {
    const fileName = `generated/${dashboard.uid}/${panel.id}.spec.ts`;
    const content = generatePanelSpec(dashboard, panel, seedInstanceCount, dashHash);
    files.push({ path: fileName, content });
  }

  // Variable cascade specs
  if (dashboard.variables.length > 0) {
    const fileName = `generated/${dashboard.uid}/variables.spec.ts`;
    const content = generateVariableSpec(dashboard, dashHash);
    files.push({ path: fileName, content });
  }

  // Dashboard-level spec
  const dashFileName = `generated/${dashboard.uid}/dashboard.spec.ts`;
  const dashContent = generateDashboardSpec(dashboard, dashHash);
  files.push({ path: dashFileName, content: dashContent });

  return files;
}

export interface GeneratedFile {
  path: string;
  content: string;
}

function fileHeader(dashHash: string): string {
  return `/**
 * AUTO-GENERATED — do not edit manually.
 * Source dashboard hash: ${dashHash}
 * Re-run the generator to update this file.
 */

`;
}

function generatePanelSpec(
  dashboard: ParsedDashboard,
  panel: ParsedPanel,
  seedInstanceCount: number,
  dashHash: string
): string {
  const seriesCount = estimateSeriesCount(panel, seedInstanceCount);

  return `${fileHeader(dashHash)}import { test, expect } from "@playwright/test";
import { GrafanaDashboardPage } from "../../pages/grafana-dashboard.page";
import { SEED_FROM_EPOCH_MS, SEED_TO_EPOCH_MS } from "../../fixtures/test-constants";

const DASHBOARD_UID = "${dashboard.uid}";

test.describe("${dashboard.title} — Panel: ${panel.title}", () => {
  let dashboard: GrafanaDashboardPage;

  test.beforeEach(async ({ page }) => {
    dashboard = new GrafanaDashboardPage(page);
    await dashboard.goto(DASHBOARD_UID, SEED_FROM_EPOCH_MS, SEED_TO_EPOCH_MS);
  });

  test("${panel.title} renders without error state @smoke", async () => {
    await dashboard.expectPanelRendered("${panel.title}");
  });

  test("${panel.title} is not in error state", async () => {
    const panelContainer = dashboard.panel("${panel.title}");
    const errorAlert = panelContainer.locator('[data-testid="data-testid Panel status error"]');
    await expect(errorAlert).not.toBeVisible({ timeout: 10_000 });
  });
${
  seriesCount > 0
    ? `
  test("${panel.title} shows expected series count (${seriesCount})", async () => {
    const legendCount = await dashboard.getLegendItemCount("${panel.title}");
    expect(legendCount).toBe(${seriesCount});
  });
`
    : ""
}});
`;
}

/**
 * Emit the per-variable coverage tests for one template variable (#20).
 *
 * Coverage scales with what the variable declares:
 * - always: the dropdown is visible and reflected in the URL (`var-<name>`).
 * - `includeAll`: an "All" option is offered.
 * - `multi` or query-backed: the dropdown actually populates options.
 * - dependencies: selecting a value cascades to dependent panels.
 *
 * Returned as an array of `test(...)` snippet strings so it is trivially
 * unit-testable and easy to join into a spec body.
 */
export function buildVariableCoverageTests(v: ParsedVariable): string[] {
  const tests: string[] = [];
  const name = v.name;

  tests.push(`
  test("template variable '${name}' dropdown is visible and in the URL", async ({ page }) => {
    await expect(dashboard.variableDropdown("${name}")).toBeVisible();
    await dashboard.expectVariableInUrl("${name}");
  });`);

  if (v.includeAll) {
    tests.push(`
  test("${name} offers an 'All' option", async () => {
    await dashboard.expectVariableHasAllOption("${name}");
  });`);
  }

  // Query/custom variables (and multi-selects) should present real options.
  const populates = v.multi || v.type === "query" || v.type === "custom";
  if (populates) {
    tests.push(`
  test("${name} dropdown populates options", async () => {
    const count = await dashboard.getVariableOptionCount("${name}");
    expect(count).toBeGreaterThan(0);
  });`);
  }

  if (v.dependencies.length > 0) {
    tests.push(`
  test("${name} cascades to dependent panels on selection", async () => {
    // Select a specific value and verify panels refresh
    await dashboard.selectVariable("${name}", "host-a");
    await dashboard.expectNoPanelErrors();
  });`);
  }

  return tests;
}

function generateVariableSpec(
  dashboard: ParsedDashboard,
  dashHash: string
): string {
  const variableTests = dashboard.variables
    .flatMap((v) => buildVariableCoverageTests(v))
    .join("\n");

  return `${fileHeader(dashHash)}import { test, expect } from "@playwright/test";
import { GrafanaDashboardPage } from "../../pages/grafana-dashboard.page";
import { SEED_FROM_EPOCH_MS, SEED_TO_EPOCH_MS } from "../../fixtures/test-constants";

const DASHBOARD_UID = "${dashboard.uid}";

test.describe("${dashboard.title} — Template Variables", () => {
  let dashboard: GrafanaDashboardPage;

  test.beforeEach(async ({ page }) => {
    dashboard = new GrafanaDashboardPage(page);
    await dashboard.goto(DASHBOARD_UID, SEED_FROM_EPOCH_MS, SEED_TO_EPOCH_MS);
  });
${variableTests}
});
`;
}

function generateDashboardSpec(
  dashboard: ParsedDashboard,
  dashHash: string
): string {
  return `${fileHeader(dashHash)}import { test } from "@playwright/test";
import { GrafanaDashboardPage } from "../../pages/grafana-dashboard.page";
import { SEED_FROM_EPOCH_MS, SEED_TO_EPOCH_MS } from "../../fixtures/test-constants";

const DASHBOARD_UID = "${dashboard.uid}";

test.describe("${dashboard.title} — Dashboard Level @smoke", () => {
  let dashboard: GrafanaDashboardPage;

  test.beforeEach(async ({ page }) => {
    dashboard = new GrafanaDashboardPage(page);
    await dashboard.goto(DASHBOARD_UID, SEED_FROM_EPOCH_MS, SEED_TO_EPOCH_MS);
  });

  test("dashboard loads with all ${dashboard.panels.length} panels visible", async () => {
    await dashboard.expectPanelCount(${dashboard.panels.length});
  });

  test("no panels are in error state after load", async () => {
    await dashboard.expectNoPanelErrors();
  });
});
`;
}

/** Estimate the number of series a panel will display based on seed data */
function estimateSeriesCount(
  panel: ParsedPanel,
  seedInstanceCount: number
): number {
  if (panel.targets.length === 0) return 0;

  let total = 0;
  for (const target of panel.targets) {
    // Check if the query has a by-clause or label matchers suggesting multiple series
    if (target.expr.includes("{") && target.expr.includes("direction")) {
      // Multi-label: instance × direction
      total += seedInstanceCount * 2;
    } else if (
      target.expr.includes("by (") ||
      target.expr.includes("by(") ||
      target.expr.includes("{instance")
    ) {
      // If it's a sum/avg by instance, each instance gets a series
      total += seedInstanceCount;
    } else if (target.expr.includes("{")) {
      total += seedInstanceCount;
    } else {
      total += 1;
    }
  }

  return total;
}
