/**
 * One-command dev stack (#23).
 *
 * Starts the API, orchestrator worker, and frontend dev server together with
 * prefixed, color-coded output, and shuts them all down on Ctrl-C or if any one
 * of them exits. Uses only Node's child_process — no extra dependency.
 *
 * Usage: `npm run dev`
 * Note: this does NOT start Docker/Postgres/Redis. Run `npm run env:up` first
 * (or the full `npm run env:setup`) so the API and orchestrator can connect.
 */

import { spawn, type ChildProcess } from "child_process";
import path from "path";

interface Service {
  name: string;
  command: string;
  args: string[];
  color: string;
  cwd?: string;
}

const RESET = "\x1b[0m";
const PROJECT_ROOT = path.resolve(__dirname, "..");

const services: Service[] = [
  { name: "api", command: "npm", args: ["run", "api:dev"], color: "\x1b[36m" }, // cyan
  {
    name: "orchestrator",
    command: "npm",
    args: ["run", "orchestrator:dev"],
    color: "\x1b[35m", // magenta
  },
  { name: "frontend", command: "npm", args: ["run", "frontend:dev"], color: "\x1b[33m" }, // yellow
];

// Longest name so prefixes align in the combined output.
const pad = Math.max(...services.map((s) => s.name.length));

const children: ChildProcess[] = [];
let shuttingDown = false;

/** Prefix every line of a chunk with the service's color-coded name. */
function makePrinter(svc: Service, target: NodeJS.WriteStream) {
  const label = `${svc.color}[${svc.name.padEnd(pad)}]${RESET}`;
  let buffer = "";
  return (data: Buffer) => {
    buffer += data.toString();
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) target.write(`${label} ${line}\n`);
  };
}

function shutdown(code: number) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log("\nShutting down dev stack...");
  for (const child of children) {
    if (!child.killed) child.kill("SIGTERM");
  }
  // Give children a moment to exit cleanly, then force-exit.
  setTimeout(() => process.exit(code), 1500);
}

for (const svc of services) {
  const child = spawn(svc.command, svc.args, {
    cwd: svc.cwd ?? PROJECT_ROOT,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout?.on("data", makePrinter(svc, process.stdout));
  child.stderr?.on("data", makePrinter(svc, process.stderr));
  child.on("exit", (code) => {
    console.log(`${svc.color}[${svc.name}]${RESET} exited with code ${code ?? 0}`);
    // If any service dies, tear the whole stack down so failures are obvious.
    shutdown(code ?? 1);
  });
  children.push(child);
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

console.log(
  `Started ${services.map((s) => s.name).join(", ")}. Press Ctrl-C to stop all.\n` +
    "Tip: run `npm run env:up` first if Postgres/Redis aren't running yet."
);
