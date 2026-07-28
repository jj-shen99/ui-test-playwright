/**
 * M1 handwritten test for the Sample Infrastructure Dashboard.
 * Validates deterministic rendering against the seed dataset with absolute time ranges (§7.4).
 *
 * @tags smoke
 */

import { test, expect } from "@playwright/test";
import { GrafanaDashboardPage } from "../pages/grafana-dashboard.page";
import {
  SEED_FROM_EPOCH_MS,
  SEED_TO_EPOCH_MS,
  SEED_INSTANCE_COUNT,
} from "../fixtures/test-constants";

const DASHBOARD_UID = "sample-infra";

test.describe("Sample Infrastructure Dashboard @smoke", () => {
  let dashboard: GrafanaDashboardPage;

  test.beforeEach(async ({ page }) => {
    dashboard = new GrafanaDashboardPage(page);
    await dashboard.goto(DASHBOARD_UID, SEED_FROM_EPOCH_MS, SEED_TO_EPOCH_MS);
  });

  test("dashboard loads with all 4 panels visible", async () => {
    await dashboard.expectPanelCount(4);
  });

  test("no panels are in error state", async () => {
    await dashboard.expectNoPanelErrors();
  });

  test("CPU Usage panel renders without error", async () => {
    await dashboard.expectPanelRendered("CPU Usage");
  });

  test("Memory Usage panel renders without error", async () => {
    await dashboard.expectPanelRendered("Memory Usage");
  });

  test("Disk IO Rate panel renders without error", async () => {
    await dashboard.expectPanelRendered("Disk IO Rate");
  });

  test("Network Traffic panel renders without error", async () => {
    await dashboard.expectPanelRendered("Network Traffic");
  });

  test("CPU Usage panel shows expected number of series from seed data", async () => {
    const legendCount = await dashboard.getLegendItemCount("CPU Usage");
    // Seed has 3 instances (host-a, host-b, host-c)
    expect(legendCount).toBe(SEED_INSTANCE_COUNT);
  });

  test("Memory Usage panel shows expected number of series from seed data", async () => {
    const legendCount = await dashboard.getLegendItemCount("Memory Usage");
    expect(legendCount).toBe(SEED_INSTANCE_COUNT);
  });

  test("CPU Usage legend labels match seed instances", async () => {
    const labels = await dashboard.getLegendLabels("CPU Usage");
    expect(labels.sort()).toEqual(["host-a", "host-b", "host-c"]);
  });

  test("template variable 'instance' dropdown is visible", async ({ page }) => {
    const varDropdown = dashboard.variableDropdown("instance");
    await expect(varDropdown).toBeVisible();
  });

  test("selecting a single instance filters panels correctly", async () => {
    await dashboard.selectVariable("instance", "host-a");

    // After selecting host-a, CPU panel should show 1 series
    const legendCount = await dashboard.getLegendItemCount("CPU Usage");
    expect(legendCount).toBe(1);
  });
});
