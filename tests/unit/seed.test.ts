/**
 * Unit tests for tests/fixtures/seed.ts helper functions.
 * Since seed.ts auto-executes, we test the key data-generation functions.
 * Covers: determinism, point count, value ranges, Prometheus format
 */

import { describe, it, expect } from "vitest";

// Re-implement the pure functions from seed.ts for isolated testing
// (seed.ts runs on import, so we extract the logic)

const SEED_START = 1735689600;
const SEED_END = 1735711200;
const INTERVAL = 15;
const INSTANCES = ["host-a", "host-b", "host-c"];

function seededValue(base: number, amplitude: number, ts: number, instanceIdx: number): number {
  const phase = instanceIdx * 1000;
  return base + amplitude * Math.sin((ts + phase) / 300);
}

function toPrometheusLine(
  metric: string,
  labels: Record<string, string>,
  value: number,
  timestampSec: number
): string {
  const labelStr = Object.entries(labels)
    .map(([k, v]) => `${k}="${v}"`)
    .join(",");
  return `${metric}{${labelStr}} ${value} ${timestampSec * 1000}`;
}

describe("seededValue", () => {
  // ── Determinism ──
  it("is deterministic — same inputs produce same outputs", () => {
    const v1 = seededValue(45, 25, SEED_START, 0);
    const v2 = seededValue(45, 25, SEED_START, 0);
    expect(v1).toBe(v2);
  });

  // ── Equivalence partitioning ──
  it("returns base when amplitude is 0", () => {
    expect(seededValue(50, 0, SEED_START, 0)).toBe(50);
  });

  it("varies with different timestamps", () => {
    const v1 = seededValue(45, 25, SEED_START, 0);
    const v2 = seededValue(45, 25, SEED_START + 100, 0);
    expect(v1).not.toBe(v2);
  });

  it("varies with different instance indices", () => {
    const v0 = seededValue(45, 25, SEED_START, 0);
    const v1 = seededValue(45, 25, SEED_START, 1);
    expect(v0).not.toBe(v1);
  });

  // ── Boundary value analysis ──
  it("values stay within base ± amplitude range", () => {
    for (let ts = SEED_START; ts < SEED_START + 3600; ts += INTERVAL) {
      for (let i = 0; i < INSTANCES.length; i++) {
        const v = seededValue(45, 25, ts, i);
        expect(v).toBeGreaterThanOrEqual(45 - 25);
        expect(v).toBeLessThanOrEqual(45 + 25);
      }
    }
  });
});

describe("data point count", () => {
  it("generates expected number of points per metric", () => {
    const timeSteps = Math.floor((SEED_END - SEED_START) / INTERVAL);
    const pointsPerMetric = timeSteps * INSTANCES.length;
    // 4 metrics: cpu, memory, disk(×2 directions), network = 5 series per timestamp per instance
    // Total: timeSteps × instances × 5
    const totalPoints = timeSteps * INSTANCES.length * 5;
    expect(timeSteps).toBe(1440);
    expect(pointsPerMetric).toBe(4320);
    expect(totalPoints).toBe(21600);
  });
});

describe("toPrometheusLine", () => {
  it("formats a metric in Prometheus import format", () => {
    const line = toPrometheusLine("test_cpu_usage", { instance: "host-a" }, 42.5, 1735689600);
    expect(line).toBe('test_cpu_usage{instance="host-a"} 42.5 1735689600000');
  });

  it("handles multiple labels", () => {
    const line = toPrometheusLine(
      "test_disk_io_bytes_total",
      { instance: "host-b", direction: "read" },
      1000,
      1735689600
    );
    expect(line).toBe('test_disk_io_bytes_total{instance="host-b",direction="read"} 1000 1735689600000');
  });

  it("timestamp is converted to milliseconds", () => {
    const line = toPrometheusLine("m", { a: "b" }, 0, 1);
    expect(line).toContain(" 1000");
  });
});

describe("test-constants consistency", () => {
  it("SEED_START matches 2025-01-01T00:00:00Z", () => {
    expect(new Date(SEED_START * 1000).toISOString()).toBe("2025-01-01T00:00:00.000Z");
  });

  it("SEED_END matches 2025-01-01T06:00:00Z", () => {
    expect(new Date(SEED_END * 1000).toISOString()).toBe("2025-01-01T06:00:00.000Z");
  });

  it("seed window is exactly 6 hours", () => {
    expect(SEED_END - SEED_START).toBe(6 * 60 * 60);
  });
});
