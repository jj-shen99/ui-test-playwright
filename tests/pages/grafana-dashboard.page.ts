/**
 * Page-object layer for Grafana dashboards (NFR-7).
 * Wraps Grafana's data-testid selectors so tests don't couple to CSS/styling (§7.4).
 * Pinned to Grafana 11.x selector conventions.
 */

import { type Page, type Locator, expect } from "@playwright/test";

/**
 * Grafana 11.x `data-testid` selectors this suite depends on.
 *
 * CONTRACT: these attribute values are treated as API. Grafana emits them via
 * `@grafana/e2e-selectors`; renaming one upstream is a breaking change for this
 * suite. Centralizing them here (instead of scattering string literals through
 * the specs) is the "data-testid is API — write it down" discipline: one place
 * to audit and one place to update on a Grafana upgrade. The catalogue is
 * mirrored in app_tests/README.md.
 *
 * Prefer `getByTestId(...)` over a raw `[data-testid=...]` locator — it climbs
 * the locator ladder and reads as intent rather than CSS.
 */
export const TESTID = {
  dashboard: "data-testid Dashboard",
  templateVarsSubmenu: "data-testid Dashboard template variables submenu",
  panelHeader: (title: string) => `data-testid Panel header ${title}`,
  panelHeaderPrefix: /^data-testid Panel header/,
  panelError: "data-testid Panel status error",
  panelLoadingBar: "data-testid Panel loading bar",
  legendSeriesPrefix: /^data-testid VizLegend series/,
  variable: (name: string) => `data-testid variable-${name}`,
} as const;

/**
 * The single sanctioned CSS coupling in this file. Grafana's viz legend exposes
 * stable per-series `data-testid`s (always preferred), but some legend
 * configurations render only Emotion-class markup. This fallback is *gated* —
 * used only when the testid is absent — and documented as a known-fragile
 * coupling to revisit on each Grafana upgrade.
 */
const LEGEND_CSS_FALLBACK = '[class*="LegendItem"]';

export class GrafanaDashboardPage {
  readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  // ── Navigation ──

  /** Navigate to a dashboard with absolute time range */
  async goto(uid: string, from: number, to: number, extraParams: Record<string, string> = {}) {
    const params = new URLSearchParams({
      from: String(from),
      to: String(to),
      ...extraParams,
    });
    await this.page.goto(`/d/${uid}?${params.toString()}`);
    await this.waitForDashboardLoad();
  }

  // ── Panels ──

  /** Get a panel by its title */
  panel(title: string): Locator {
    return this.page.getByTestId(TESTID.panelHeader(title)).locator("xpath=../..");
  }

  /** Get a panel's header by title */
  panelHeader(title: string): Locator {
    return this.page.getByTestId(TESTID.panelHeader(title));
  }

  /** Get all panel containers on the page */
  allPanels(): Locator {
    return this.page.getByTestId(TESTID.panelHeaderPrefix);
  }

  /** Assert a panel is visible and not in error state */
  async expectPanelRendered(title: string) {
    const header = this.panelHeader(title);
    await expect(header).toBeVisible({ timeout: 30_000 });

    // Check no error state on the panel
    const panelContainer = this.panel(title);
    const errorAlert = panelContainer.getByTestId(TESTID.panelError);
    await expect(errorAlert).not.toBeVisible({ timeout: 5_000 });
  }

  /** Assert a panel is in error state */
  async expectPanelError(title: string) {
    const panelContainer = this.panel(title);
    const errorAlert = panelContainer.getByTestId(TESTID.panelError);
    await expect(errorAlert).toBeVisible({ timeout: 15_000 });
  }

  /**
   * Resolve the legend series of a panel, testid-first with the single gated
   * CSS fallback (see LEGEND_CSS_FALLBACK). Shared by the count/label helpers.
   */
  private async legendSeries(title: string): Promise<Locator> {
    const panelContainer = this.panel(title);
    const byTestId = panelContainer.getByTestId(TESTID.legendSeriesPrefix);
    if ((await byTestId.count()) > 0) return byTestId;
    return panelContainer.locator(LEGEND_CSS_FALLBACK);
  }

  /** Count the number of legend items in a time-series panel */
  async getLegendItemCount(title: string): Promise<number> {
    return (await this.legendSeries(title)).count();
  }

  /** Get legend labels from a panel */
  async getLegendLabels(title: string): Promise<string[]> {
    const texts = await (await this.legendSeries(title)).allTextContents();
    return texts.filter((t) => t.trim().length > 0);
  }

  // ── Template Variables ──

  /** Get a template variable dropdown by name */
  variableDropdown(name: string): Locator {
    return this.page.getByTestId(TESTID.variable(name));
  }

  /** Select a value in a template variable dropdown */
  async selectVariable(name: string, value: string) {
    const dropdown = this.variableDropdown(name);
    await dropdown.click();
    // Grafana uses a listbox for variable options
    const option = this.page.getByRole("option", { name: value });
    await option.click();
    // Wait for panels to refresh after variable change
    await this.waitForPanelDataLoad();
  }

  /** Open a template variable dropdown to reveal its option list. */
  async openVariable(name: string) {
    await this.variableDropdown(name).click();
    // Options render into a listbox; wait until at least one is visible.
    // Visibility asserts on a single element, so `.first()` is a genuine gate.
    // eslint-disable-next-line playwright/no-nth-methods -- "at least one option visible" gate
    await this.page.getByRole("option").first().waitFor({ state: "visible", timeout: 15_000 });
  }

  /** Count the options presented after opening a variable dropdown. */
  async getVariableOptionCount(name: string): Promise<number> {
    await this.openVariable(name);
    return this.page.getByRole("option").count();
  }

  /** Assert a variable dropdown offers an "All" option (for includeAll variables). */
  async expectVariableHasAllOption(name: string) {
    await this.openVariable(name);
    await expect(this.page.getByRole("option", { name: /^All$/i })).toBeVisible({
      timeout: 10_000,
    });
  }

  /** Assert the current URL carries the `var-<name>` query parameter for a variable. */
  async expectVariableInUrl(name: string) {
    await expect
      .poll(() => new URL(this.page.url()).searchParams.has(`var-${name}`), {
        timeout: 10_000,
      })
      .toBe(true);
  }

  // ── Waiting ──

  /** Wait for the dashboard to finish loading (initial page load) */
  async waitForDashboardLoad() {
    // Wait for a stable dashboard-ready signal. Any one of these testids means
    // the shell has rendered; `.first()` just picks whichever arrives.
    await this.page.getByTestId(TESTID.templateVarsSubmenu)
      .or(this.page.getByTestId(TESTID.dashboard))
      .or(this.page.getByTestId(TESTID.panelHeaderPrefix))
      // eslint-disable-next-line playwright/no-nth-methods -- any one ready-signal suffices; take whichever arrives
      .first()
      .waitFor({ state: "visible", timeout: 30_000 });

    // Wait for panel data requests to complete
    await this.waitForPanelDataLoad();
  }

  /**
   * Wait for panel data to settle after a load, variable change, or refresh.
   *
   * Follows the "wait for the end state, not the flicker" rule: we do NOT wait
   * for a loading indicator to appear and then disappear. That transient races
   * the app's own speed — on a fast render the bar comes and goes before we
   * ever look, so a fixed pause is both too short (misses the slow case) and
   * too long (taxes every fast run). Instead we wait only for the durable end
   * state — no loading indicators present — which `toHaveCount(0)` retries
   * toward for exactly as long as this run needs.
   *
   * This is a best-effort synchronization point; the real correctness comes
   * from the per-panel render assertions (which also retry), so a timeout here
   * is swallowed rather than failing the test prematurely.
   */
  async waitForPanelDataLoad() {
    const loadingIndicators = this.page.getByTestId(TESTID.panelLoadingBar);

    try {
      await expect(loadingIndicators).toHaveCount(0, { timeout: 30_000 });
    } catch {
      // Still loading after the ceiling — proceed anyway; the individual panel
      // assertions that follow retry and will surface a genuinely stuck panel.
    }
  }

  // ── Dashboard-level assertions ──

  /** Assert that no panel on the dashboard is in an error state */
  async expectNoPanelErrors() {
    const errorPanels = this.page.getByTestId(TESTID.panelError);
    await expect(errorPanels).toHaveCount(0, { timeout: 10_000 });
  }

  /** Assert a specific number of panels are visible */
  async expectPanelCount(count: number) {
    const headers = this.allPanels();
    await expect(headers).toHaveCount(count, { timeout: 15_000 });
  }
}
