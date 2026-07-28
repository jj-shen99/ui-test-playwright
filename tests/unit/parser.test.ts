/**
 * Unit tests for services/generation/parser.ts
 * Covers: parseDashboard, panel extraction, variable extraction, row handling
 */

import { describe, it, expect } from "vitest";
import { parseDashboard } from "../../services/generation/parser";

describe("parseDashboard", () => {
  // ── Equivalence partitioning ──

  it("parses a minimal valid dashboard", () => {
    const result = parseDashboard({
      uid: "test-uid",
      title: "Test Dashboard",
      tags: ["tag1"],
      panels: [],
      templating: { list: [] },
    });
    expect(result.uid).toBe("test-uid");
    expect(result.title).toBe("Test Dashboard");
    expect(result.tags).toEqual(["tag1"]);
    expect(result.panels).toEqual([]);
    expect(result.variables).toEqual([]);
  });

  it("falls back to defaults for missing fields", () => {
    const result = parseDashboard({});
    expect(result.uid).toBe("unknown");
    expect(result.title).toBe("Untitled");
    expect(result.tags).toEqual([]);
    expect(result.panels).toEqual([]);
    expect(result.variables).toEqual([]);
  });

  // ── Panel parsing ──

  it("extracts panels with targets", () => {
    const result = parseDashboard({
      uid: "d1",
      title: "D",
      panels: [
        {
          id: 1,
          title: "CPU",
          type: "timeseries",
          targets: [{ expr: "cpu_usage{}", refId: "A" }],
        },
      ],
    });
    expect(result.panels).toHaveLength(1);
    expect(result.panels[0].title).toBe("CPU");
    expect(result.panels[0].type).toBe("timeseries");
    expect(result.panels[0].targets).toHaveLength(1);
    expect(result.panels[0].targets[0].expr).toBe("cpu_usage{}");
  });

  it("handles panels without targets", () => {
    const result = parseDashboard({
      uid: "d1",
      title: "D",
      panels: [{ id: 1, title: "Text", type: "text" }],
    });
    expect(result.panels).toHaveLength(1);
    expect(result.panels[0].targets).toEqual([]);
  });

  it("handles panels without a title — defaults to Panel N", () => {
    const result = parseDashboard({
      uid: "d1",
      title: "D",
      panels: [{ id: 42, type: "stat" }],
    });
    expect(result.panels[0].title).toBe("Panel 42");
  });

  // ── Row handling ──

  it("extracts nested panels from row-type panels", () => {
    const result = parseDashboard({
      uid: "d1",
      title: "D",
      panels: [
        {
          type: "row",
          panels: [
            { id: 1, title: "Nested", type: "graph", targets: [] },
          ],
        },
      ],
    });
    expect(result.panels).toHaveLength(1);
    expect(result.panels[0].title).toBe("Nested");
  });

  it("skips empty row panels", () => {
    const result = parseDashboard({
      uid: "d1",
      title: "D",
      panels: [{ type: "row" }],
    });
    expect(result.panels).toEqual([]);
  });

  // ── Variable parsing ──

  it("extracts template variables with dependencies", () => {
    const result = parseDashboard({
      uid: "d1",
      title: "D",
      templating: {
        list: [
          {
            name: "instance",
            type: "query",
            query: "label_values(cpu{job=\"$job\"}, instance)",
            includeAll: true,
            multi: true,
          },
        ],
      },
    });
    expect(result.variables).toHaveLength(1);
    expect(result.variables[0].name).toBe("instance");
    expect(result.variables[0].dependencies).toEqual(["job"]);
    expect(result.variables[0].includeAll).toBe(true);
    expect(result.variables[0].multi).toBe(true);
  });

  it("extracts ${var} style variable references", () => {
    const result = parseDashboard({
      uid: "d1",
      title: "D",
      templating: {
        list: [
          { name: "dc", type: "query", query: "label_values(up{region=\"${region}\"}, dc)" },
        ],
      },
    });
    expect(result.variables[0].dependencies).toEqual(["region"]);
  });

  it("excludes Grafana built-in variables (__from, __to, etc.)", () => {
    const result = parseDashboard({
      uid: "d1",
      title: "D",
      templating: {
        list: [
          { name: "x", type: "query", query: "query_result($__interval, $user_var)" },
        ],
      },
    });
    expect(result.variables[0].dependencies).toEqual(["user_var"]);
  });

  it("handles missing templating gracefully", () => {
    const result = parseDashboard({ uid: "d1", title: "D" });
    expect(result.variables).toEqual([]);
  });

  // ── Boundary ──

  it("handles null/undefined panels array", () => {
    const result = parseDashboard({ uid: "d1", title: "D", panels: null as any });
    expect(result.panels).toEqual([]);
  });

  // ── Integration: real sample dashboard ──

  it("parses the sample-infra dashboard correctly", () => {
    const sampleDashboard = {
      uid: "sample-infra",
      title: "Sample Infrastructure Dashboard",
      tags: ["generated", "infra"],
      panels: [
        { id: 1, title: "CPU Usage", type: "timeseries", targets: [{ expr: "test_cpu_usage{instance=~\"$instance\"}", refId: "A" }] },
        { id: 2, title: "Memory Usage", type: "timeseries", targets: [{ expr: "test_memory_usage_bytes{instance=~\"$instance\"}", refId: "A" }] },
        { id: 3, title: "Disk IO Rate", type: "timeseries", targets: [{ expr: "rate(test_disk_io_bytes_total{instance=~\"$instance\"}[5m])", refId: "A" }] },
        { id: 4, title: "Network Traffic", type: "stat", targets: [{ expr: "sum(rate(test_network_bytes_total{instance=~\"$instance\"}[5m])) by (instance)", refId: "A" }] },
      ],
      templating: {
        list: [{ name: "instance", type: "query", query: "label_values(test_cpu_usage, instance)", includeAll: true, multi: true }],
      },
    };

    const result = parseDashboard(sampleDashboard);
    expect(result.uid).toBe("sample-infra");
    expect(result.panels).toHaveLength(4);
    expect(result.variables).toHaveLength(1);
    expect(result.variables[0].name).toBe("instance");
  });
});
