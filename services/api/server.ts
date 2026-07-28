/**
 * API / Control Plane (§8.5)
 * Single Fastify gateway for the frontend and CI.
 * Implements the contracts from §10.
 */

import "dotenv/config";
import Fastify from "fastify";
import cors from "@fastify/cors";
import sensible from "@fastify/sensible";
import { runsRoutes } from "./routes/runs";
import { testsRoutes } from "./routes/tests";
import { insightsRoutes } from "./routes/insights";
import { generateRoutes } from "./routes/generate";
import { usersRoutes } from "./routes/users";
import { schedulesRoutes } from "./routes/schedules";
import { targetsRoutes } from "./routes/targets";
import { auditRoutes } from "./routes/audit";
import { authProfilesRoutes } from "./routes/auth-profiles";
import { pool } from "../../db/connection";
import { redactConfig, SECRET_CONFIG_KEYS } from "../shared/redact";

const PORT = Number(process.env.API_PORT) || 6199;

async function buildApp() {
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL || "info",
      transport:
        process.env.NODE_ENV !== "production"
          ? { target: "pino-pretty" }
          : undefined,
    },
  });

  await app.register(cors, { origin: true });
  await app.register(sensible);

  // Health check
  app.get("/api/health", async () => ({ status: "ok" }));

  // Config defaults (env vars as fallback)
  const CONFIG_DEFAULTS: Record<string, string> = {
    testRepoUrl: process.env.TEST_REPO_URL || "https://code.devsnc.com/jianjun-shen/grafana-ui-testing",
    testRepoBranch: process.env.TEST_REPO_BRANCH || "main",
    apiEndpoint: process.env.VITE_API_URL || "http://localhost:6199",
    grafanaUrl: process.env.GRAFANA_URL || "http://localhost:3000",
    victoriaMetricsUrl: process.env.VICTORIAMETRICS_URL || "http://localhost:8428",
    // Default authentication used when a run/generation targets these services
    // without supplying its own credentials. authType: 'none' | 'basic' | 'token'.
    grafanaAuthType: process.env.GRAFANA_AUTH_TYPE || "none",
    grafanaAuthUser: process.env.GRAFANA_USER || "",
    grafanaAuthPassword: process.env.GRAFANA_PASSWORD || "",
    grafanaAuthToken: process.env.GRAFANA_TOKEN || "",
    vmAuthType: process.env.VM_AUTH_TYPE || "none",
    vmAuthUser: process.env.VM_GRAFANA_USER || "",
    vmAuthPassword: process.env.VM_GRAFANA_PASSWORD || "",
    vmAuthToken: process.env.VM_GRAFANA_TOKEN || "",
  };

  // Helper: read all config from DB, merge with defaults
  async function getFullConfig(): Promise<Record<string, string>> {
    const merged = { ...CONFIG_DEFAULTS };
    try {
      const { rows } = await pool.query("SELECT key, value FROM app_config");
      for (const row of rows) {
        merged[row.key] = row.value;
      }
    } catch {
      // table may not exist yet; fall back to defaults
    }
    return merged;
  }

  // GET /api/config — return all settings (secret values masked, #18)
  app.get("/api/config", async () => {
    return redactConfig(await getFullConfig());
  });

  // PUT /api/config — upsert one or more settings
  app.put("/api/config", async (request, reply) => {
    const body = request.body as Record<string, string>;
    if (!body || typeof body !== "object") {
      return reply.badRequest("Request body must be a JSON object of key-value pairs");
    }
    const entries = Object.entries(body).filter(
      ([key, v]) =>
        typeof v === "string" &&
        // Never persist a masked secret back over the real value (#18): the UI
        // shows masked secrets, so a save that didn't change one would clobber it.
        !(SECRET_CONFIG_KEYS.has(key) && v.includes("\u2022"))
    );
    if (entries.length === 0) {
      return reply.badRequest("No valid key-value pairs provided");
    }
    for (const [key, value] of entries) {
      await pool.query(
        `INSERT INTO app_config (key, value, updated_at) VALUES ($1, $2, now())
         ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = now()`,
        [key, value]
      );
    }
    return redactConfig(await getFullConfig());
  });

  // Register route groups
  await app.register(runsRoutes, { prefix: "/api" });
  await app.register(testsRoutes, { prefix: "/api" });
  await app.register(insightsRoutes, { prefix: "/api" });
  await app.register(generateRoutes, { prefix: "/api" });
  await app.register(usersRoutes, { prefix: "/api" });
  await app.register(schedulesRoutes, { prefix: "/api" });
  await app.register(targetsRoutes, { prefix: "/api" });
  await app.register(auditRoutes, { prefix: "/api" });
  await app.register(authProfilesRoutes, { prefix: "/api" });

  return app;
}

async function start() {
  const app = await buildApp();

  try {
    await app.listen({ port: PORT, host: "0.0.0.0" });
    console.log(`API server listening on port ${PORT}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }

  // Graceful shutdown
  const shutdown = async () => {
    await app.close();
    await pool.end();
    process.exit(0);
  };

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

start();

export { buildApp };
