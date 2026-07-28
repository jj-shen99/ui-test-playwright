/**
 * Playwright codegen wrapper (FR-3).
 * Launches codegen pre-configured for the deterministic Grafana environment.
 *
 * Usage:
 *   npx tsx scripts/codegen.ts [--output <file>]
 *
 * Launches Playwright codegen pointed at the local Grafana instance,
 * pre-authenticated with the saved auth state.
 */

import "dotenv/config";
import { execSync } from "child_process";
import fs from "fs";
import path from "path";

const GRAFANA_URL = process.env.GRAFANA_URL || "http://localhost:3000";
const AUTH_STATE = path.resolve(__dirname, "../tests/fixtures/auth-state.json");

async function main() {
  const args = process.argv.slice(2);
  const outputIdx = args.indexOf("--output");
  const outputFile = outputIdx >= 0 ? args[outputIdx + 1] : undefined;

  // Check if auth state exists
  if (!fs.existsSync(AUTH_STATE)) {
    console.error(
      "Auth state not found. Run Playwright tests once to generate it:\n" +
      "  npx playwright test --project=setup"
    );
    process.exit(1);
  }

  console.log(`Launching Playwright codegen against ${GRAFANA_URL}`);
  console.log(`Auth state: ${AUTH_STATE}`);
  if (outputFile) {
    console.log(`Output file: ${outputFile}`);
  }
  console.log("---");
  console.log("Record your interactions. When done, close the browser.");
  console.log("The generated code will be printed to stdout (or saved to the output file).\n");

  const outputArg = outputFile ? ` --output ${outputFile}` : "";
  const cmd = `npx playwright codegen --load-storage=${AUTH_STATE}${outputArg} ${GRAFANA_URL}`;

  try {
    execSync(cmd, { stdio: "inherit" });
  } catch (err: any) {
    // User closed the browser — not an error
    if (err.status === 0 || err.signal === "SIGTERM") {
      return;
    }
    process.exit(err.status || 1);
  }
}

main();
