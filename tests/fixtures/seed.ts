/**
 * Seed script: generates deterministic time-series data and imports into VictoriaMetrics.
 * Uses absolute timestamps (§7.3) so tests are fully deterministic (NFR-1).
 *
 * Seed window: 2025-01-01T00:00:00Z to 2025-01-01T06:00:00Z
 */

import "dotenv/config";

const VM_URL = process.env.VM_URL || "http://localhost:8428";
const SEED_START = 1735689600; // 2025-01-01T00:00:00Z (seconds)
const SEED_END = 1735711200; // 2025-01-01T06:00:00Z (seconds)
const INTERVAL = 15; // 15-second intervals
const INSTANCES = ["host-a", "host-b", "host-c"];

interface MetricPoint {
  metric: string;
  labels: Record<string, string>;
  value: number;
  timestamp: number; // seconds
}

/** Deterministic pseudo-random based on seed — reproducible across runs */
function seededValue(
  base: number,
  amplitude: number,
  ts: number,
  instanceIdx: number
): number {
  const phase = instanceIdx * 1000;
  return base + amplitude * Math.sin((ts + phase) / 300);
}

function generatePoints(): MetricPoint[] {
  const points: MetricPoint[] = [];

  for (let ts = SEED_START; ts < SEED_END; ts += INTERVAL) {
    for (let i = 0; i < INSTANCES.length; i++) {
      const instance = INSTANCES[i];

      // CPU Usage (gauge, 0-100%)
      points.push({
        metric: "test_cpu_usage",
        labels: { instance },
        value: Math.max(0, Math.min(100, seededValue(45, 25, ts, i))),
        timestamp: ts,
      });

      // Memory Usage (gauge, bytes, ~2-8 GB range)
      points.push({
        metric: "test_memory_usage_bytes",
        labels: { instance },
        value: Math.max(0, seededValue(4e9, 2e9, ts, i)),
        timestamp: ts,
      });

      // Disk IO (counter, bytes) — read and write directions
      const diskBase = (ts - SEED_START) * 1e6 * (i + 1);
      points.push({
        metric: "test_disk_io_bytes_total",
        labels: { instance, direction: "read" },
        value: diskBase + seededValue(0, 5e5, ts, i),
        timestamp: ts,
      });
      points.push({
        metric: "test_disk_io_bytes_total",
        labels: { instance, direction: "write" },
        value: diskBase * 0.7 + seededValue(0, 3e5, ts, i),
        timestamp: ts,
      });

      // Network Traffic (counter, bytes)
      const netBase = (ts - SEED_START) * 5e5 * (i + 1);
      points.push({
        metric: "test_network_bytes_total",
        labels: { instance },
        value: netBase + seededValue(0, 1e5, ts, i),
        timestamp: ts,
      });
    }
  }

  return points;
}

function toPrometheusImportFormat(points: MetricPoint[]): string {
  return points
    .map((p) => {
      const labels = Object.entries(p.labels)
        .map(([k, v]) => `${k}="${v}"`)
        .join(",");
      // VictoriaMetrics /api/v1/import/prometheus expects: metric{labels} value timestamp_ms
      return `${p.metric}{${labels}} ${p.value} ${p.timestamp * 1000}`;
    })
    .join("\n");
}

async function seed(): Promise<void> {
  console.log("Generating seed data...");
  const points = generatePoints();
  console.log(`Generated ${points.length} data points`);

  const body = toPrometheusImportFormat(points);

  // Import in chunks to avoid hitting request size limits
  const lines = body.split("\n");
  const CHUNK_SIZE = 10000;

  for (let i = 0; i < lines.length; i += CHUNK_SIZE) {
    const chunk = lines.slice(i, i + CHUNK_SIZE).join("\n");
    const resp = await fetch(`${VM_URL}/api/v1/import/prometheus`, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: chunk,
    });

    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(
        `Seed import failed (chunk ${i / CHUNK_SIZE}): ${resp.status} ${text}`
      );
    }

    console.log(
      `Imported chunk ${Math.floor(i / CHUNK_SIZE) + 1}/${Math.ceil(lines.length / CHUNK_SIZE)}`
    );
  }

  // Force flush
  await fetch(`${VM_URL}/internal/force_flush`, { method: "GET" });

  // Verify seed data is queryable
  const verifyResp = await fetch(
    `${VM_URL}/api/v1/query?query=count(test_cpu_usage)&time=${SEED_START + 60}`
  );
  const verifyData = (await verifyResp.json()) as {
    data?: { result?: Array<{ value?: [number, string] }> };
  };
  const count = verifyData?.data?.result?.[0]?.value?.[1];

  console.log(`Verification: test_cpu_usage has ${count} series (expected ${INSTANCES.length})`);

  if (String(count) !== String(INSTANCES.length)) {
    throw new Error(
      `Seed verification failed: expected ${INSTANCES.length} series, got ${count}`
    );
  }

  console.log("Seed complete.");
}

seed().catch((err) => {
  console.error("Seeding failed:", err);
  process.exit(1);
});
