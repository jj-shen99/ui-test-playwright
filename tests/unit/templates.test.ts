/**
 * Unit tests for services/generation/templates.ts
 * Covers: generateSpecs, estimateSeriesCount, spec structure
 */

import { describe, it, expect } from "vitest";
import {
  generateSpecs,
  buildVariableCoverageTests,
} from "../../services/generation/templates";
import type { ParsedDashboard, ParsedVariable } from "../../services/generation/parser";

function makeVariable(overrides: Partial<ParsedVariable> = {}): ParsedVariable {
  return { name: "instance", type: "query", dependencies: [], ...overrides };
}

function makeDashboard(overrides: Partial<ParsedDashboard> = {}): ParsedDashboard {
  return {
    uid: "test-dash",
    title: "Test Dashboard",
    tags: [],
    panels: [],
    variables: [],
    ...overrides,
  };
}

describe("generateSpecs", () => {
  // ── Equivalence partitioning ──

  it("generates a dashboard-level spec for any dashboard", () => {
    const files = generateSpecs(makeDashboard());
    expect(files.some((f) => f.path.endsWith("dashboard.spec.ts"))).toBe(true);
  });

  it("generates one spec per panel", () => {
    const dash = makeDashboard({
      panels: [
        { id: 1, title: "CPU", type: "timeseries", targets: [{ expr: "cpu{}", refId: "A" }] },
        { id: 2, title: "Mem", type: "stat", targets: [{ expr: "mem{}", refId: "A" }] },
      ],
    });
    const files = generateSpecs(dash);
    const panelSpecs = files.filter((f) => !f.path.includes("dashboard.spec") && !f.path.includes("variables.spec"));
    expect(panelSpecs).toHaveLength(2);
    expect(panelSpecs[0].path).toContain("1.spec.ts");
    expect(panelSpecs[1].path).toContain("2.spec.ts");
  });

  it("generates a variable spec only when variables exist", () => {
    const noVars = generateSpecs(makeDashboard());
    expect(noVars.some((f) => f.path.includes("variables.spec"))).toBe(false);

    const withVars = generateSpecs(
      makeDashboard({
        variables: [{ name: "instance", type: "query", dependencies: [] }],
      })
    );
    expect(withVars.some((f) => f.path.includes("variables.spec"))).toBe(true);
  });

  // ── Content validation ──

  it("generated panel spec contains the panel title in test name", () => {
    const dash = makeDashboard({
      panels: [{ id: 1, title: "CPU Usage", type: "timeseries", targets: [{ expr: "cpu{instance}", refId: "A" }] }],
    });
    const files = generateSpecs(dash);
    const panelSpec = files.find((f) => f.path.includes("1.spec.ts"))!;
    expect(panelSpec.content).toContain("CPU Usage");
    expect(panelSpec.content).toContain("@playwright/test");
    expect(panelSpec.content).toContain("SEED_FROM_EPOCH_MS");
  });

  it("generated spec contains AUTO-GENERATED header", () => {
    const files = generateSpecs(makeDashboard());
    for (const file of files) {
      expect(file.content).toContain("AUTO-GENERATED");
    }
  });

  it("dashboard spec contains panel count assertion", () => {
    const dash = makeDashboard({
      panels: [
        { id: 1, title: "P1", type: "stat", targets: [] },
        { id: 2, title: "P2", type: "stat", targets: [] },
      ],
    });
    const files = generateSpecs(dash);
    const dashSpec = files.find((f) => f.path.includes("dashboard.spec"))!;
    expect(dashSpec.content).toContain("expectPanelCount(2)");
  });

  // ── Series count estimation ──

  it("estimates series count for instance-labelled queries", () => {
    const dash = makeDashboard({
      panels: [
        { id: 1, title: "CPU", type: "timeseries", targets: [{ expr: "cpu{instance=~\"$instance\"}", refId: "A" }] },
      ],
    });
    const files = generateSpecs(dash, 3);
    const panelSpec = files.find((f) => f.path.includes("1.spec.ts"))!;
    expect(panelSpec.content).toContain("series count (3)");
  });

  it("estimates series count for direction labels (instance × direction)", () => {
    const dash = makeDashboard({
      panels: [
        { id: 1, title: "Disk", type: "timeseries", targets: [{ expr: "disk{instance=~\"$instance\", direction=\"read\"}", refId: "A" }] },
      ],
    });
    const files = generateSpecs(dash, 3);
    const panelSpec = files.find((f) => f.path.includes("1.spec.ts"))!;
    // direction label → instance × 2 = 6
    expect(panelSpec.content).toContain("series count (6)");
  });

  it("estimates 0 series for panels with no targets", () => {
    const dash = makeDashboard({
      panels: [{ id: 1, title: "Text", type: "text", targets: [] }],
    });
    const files = generateSpecs(dash, 3);
    const panelSpec = files.find((f) => f.path.includes("1.spec.ts"))!;
    // No series count assertion if 0
    expect(panelSpec.content).not.toContain("series count");
  });

  // ── Output path structure ──

  it("uses dashboard uid in file paths", () => {
    const dash = makeDashboard({ uid: "my-dash" });
    const files = generateSpecs(dash);
    for (const file of files) {
      expect(file.path).toContain("generated/my-dash/");
    }
  });

  // ── Boundary: single panel dashboard ──

  it("works with a single-panel dashboard", () => {
    const dash = makeDashboard({
      panels: [{ id: 1, title: "Solo", type: "gauge", targets: [] }],
    });
    const files = generateSpecs(dash);
    // 1 panel spec + 1 dashboard spec
    expect(files).toHaveLength(2);
  });
});

describe("buildVariableCoverageTests (#20)", () => {
  it("always emits a visibility + in-URL test", () => {
    const tests = buildVariableCoverageTests(makeVariable({ name: "job", type: "constant" }));
    expect(tests).toHaveLength(1);
    expect(tests[0]).toContain('dashboard.variableDropdown("job")');
    expect(tests[0]).toContain('dashboard.expectVariableInUrl("job")');
  });

  it("adds an 'All' option test when includeAll is set", () => {
    const tests = buildVariableCoverageTests(
      makeVariable({ name: "instance", type: "constant", includeAll: true })
    );
    expect(tests.some((t) => t.includes('expectVariableHasAllOption("instance")'))).toBe(true);
  });

  it("adds a populate-options test for query variables", () => {
    const tests = buildVariableCoverageTests(makeVariable({ name: "ds", type: "query" }));
    expect(tests.some((t) => t.includes('getVariableOptionCount("ds")'))).toBe(true);
  });

  it("adds a populate-options test for multi-select variables even if not query", () => {
    const tests = buildVariableCoverageTests(
      makeVariable({ name: "region", type: "custom", multi: true })
    );
    expect(tests.some((t) => t.includes('getVariableOptionCount("region")'))).toBe(true);
  });

  it("does NOT add a populate test for a plain constant variable", () => {
    const tests = buildVariableCoverageTests(makeVariable({ name: "env", type: "constant" }));
    expect(tests.some((t) => t.includes("getVariableOptionCount"))).toBe(false);
  });

  it("adds a cascade test when the variable has dependencies", () => {
    const tests = buildVariableCoverageTests(
      makeVariable({ name: "pod", type: "query", dependencies: ["namespace"] })
    );
    expect(tests.some((t) => t.includes("cascades to dependent panels"))).toBe(true);
  });

  it("emits the maximal set for an includeAll+multi+query+dependent variable", () => {
    const tests = buildVariableCoverageTests(
      makeVariable({
        name: "svc",
        type: "query",
        includeAll: true,
        multi: true,
        dependencies: ["ns"],
      })
    );
    // visible+url, all-option, populate, cascade = 4
    expect(tests).toHaveLength(4);
  });

  it("wires these snippets into the generated variables.spec.ts", () => {
    const files = generateSpecs(
      makeDashboard({
        variables: [makeVariable({ name: "instance", type: "query", includeAll: true })],
      })
    );
    const varSpec = files.find((f) => f.path.includes("variables.spec"))!;
    expect(varSpec.content).toContain('expectVariableInUrl("instance")');
    expect(varSpec.content).toContain('expectVariableHasAllOption("instance")');
    expect(varSpec.content).toContain('getVariableOptionCount("instance")');
  });
});
