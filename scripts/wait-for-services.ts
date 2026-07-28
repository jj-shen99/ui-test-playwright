/**
 * Waits for all services in the Docker Compose stack to be healthy.
 */

import "dotenv/config";

const GRAFANA_URL = process.env.GRAFANA_URL || "http://localhost:3000";
const VM_URL = process.env.VM_URL || "http://localhost:8428";

const MAX_RETRIES = 60;
const RETRY_INTERVAL_MS = 2000;

async function waitForService(
  name: string,
  url: string,
  retries = MAX_RETRIES
): Promise<void> {
  for (let i = 0; i < retries; i++) {
    try {
      const resp = await fetch(url);
      if (resp.ok) {
        console.log(`✓ ${name} is ready`);
        return;
      }
    } catch {
      // service not ready yet
    }
    if (i % 5 === 0) {
      console.log(`  Waiting for ${name}... (attempt ${i + 1}/${retries})`);
    }
    await new Promise((r) => setTimeout(r, RETRY_INTERVAL_MS));
  }
  throw new Error(`${name} did not become ready after ${retries} attempts`);
}

async function main(): Promise<void> {
  console.log("Waiting for services to be ready...\n");
  await Promise.all([
    waitForService("Grafana", `${GRAFANA_URL}/api/health`),
    waitForService("VictoriaMetrics", `${VM_URL}/-/healthy`),
  ]);
  console.log("\nAll services ready.");
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
