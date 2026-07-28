/**
 * CLI entry point for the generation service (FR-3).
 * Usage:
 *   npx tsx services/generation/cli.ts --uid <dashboard-uid> [--llm] [--approve] [--file <path>]
 *
 * --llm      also produce LLM-assisted edge-case drafts (requires ANTHROPIC_API_KEY)
 * --approve  enable valid LLM drafts into the active suite instead of parking
 *            them for review (#22)
 */

import "dotenv/config";
import fs from "fs";
import { generateTests } from "./generator";

async function main() {
  const args = process.argv.slice(2);
  const uidIdx = args.indexOf("--uid");
  const fileIdx = args.indexOf("--file");
  const useLlm = args.includes("--llm");
  const approveLlm = args.includes("--approve");

  let dashboardUid: string | undefined;
  let dashboardJson: Record<string, unknown> | undefined;

  if (uidIdx >= 0 && args[uidIdx + 1]) {
    dashboardUid = args[uidIdx + 1];
  }

  if (fileIdx >= 0 && args[fileIdx + 1]) {
    const filePath = args[fileIdx + 1];
    const raw = fs.readFileSync(filePath, "utf-8");
    dashboardJson = JSON.parse(raw);
  }

  if (!dashboardUid && !dashboardJson) {
    console.error("Usage: generate --uid <dashboard-uid> [--llm] [--approve] [--file <path-to-json>]");
    process.exit(1);
  }

  console.log("Starting test generation...");
  const result = await generateTests({
    dashboardUid,
    dashboardJson,
    useLlm,
    approveLlm,
  });

  console.log(`\nGeneration complete. Files written:`);
  for (const f of result.files) {
    console.log(`  - tests/${f}`);
  }

  if (result.reviews && result.reviews.length > 0) {
    console.log(`\nLLM drafts (review gate #22):`);
    for (const r of result.reviews) {
      console.log(`  - ${r}`);
    }
    if (!approveLlm) {
      console.log(
        `  Re-run with --approve to enable valid drafts into the active suite.`
      );
    }
  }

  if (result.prUrl) {
    console.log(`\nPR: ${result.prUrl}`);
  }
}

main().catch((err) => {
  console.error("Generation failed:", err);
  process.exit(1);
});
