/**
 * Insights API routes — proxies to the ML service or reads directly from DB.
 * GET /api/insights/quarantine  → quarantine list (FR-20)
 * GET /api/insights/clusters    → failure clusters (FR-21)
 * GET /api/insights/triage      → triage suggestion (FR-22)
 */

import { type FastifyPluginAsync } from "fastify";
import { db } from "../../../db/connection";
import { testHealth, failureClusters, testResults } from "../../../db/schema";
import { eq, desc, sql } from "drizzle-orm";

const ML_SERVICE_URL = process.env.ML_SERVICE_URL || "http://localhost:8000";

export const insightsRoutes: FastifyPluginAsync = async (app) => {
  // GET /api/insights/quarantine — quarantine list
  app.get("/insights/quarantine", async () => {
    const quarantined = await db
      .select()
      .from(testHealth)
      .where(eq(testHealth.quarantined, true))
      .orderBy(desc(testHealth.flakinessScore));

    return { quarantined };
  });

  // GET /api/insights/clusters — failure clusters for a run
  app.get<{
    Querystring: { runId?: string };
  }>("/insights/clusters", async (request) => {
    if (request.query.runId) {
      // Proxy to ML service if available
      try {
        const resp = await fetch(
          `${ML_SERVICE_URL}/clusters?run_id=${request.query.runId}`
        );
        if (resp.ok) {
          return resp.json();
        }
      } catch {
        // ML service unavailable — fall back to direct DB query
      }
    }

    const clusters = await db
      .select()
      .from(failureClusters)
      .orderBy(desc(failureClusters.lastSeen));

    return { clusters };
  });

  // GET /api/insights/triage — triage suggestion for a failure
  app.get<{
    Querystring: { failureId?: string };
  }>("/insights/triage", async (request) => {
    const { failureId } = request.query;

    if (!failureId) {
      return { suggestion: null, message: "failureId is required" };
    }

    // Try ML service first
    try {
      const resp = await fetch(
        `${ML_SERVICE_URL}/triage?failure_id=${failureId}`
      );
      if (resp.ok) {
        return resp.json();
      }
    } catch {
      // ML service unavailable
    }

    // Basic fallback: find similar failures by signature
    const failure = await db
      .select()
      .from(testResults)
      .where(eq(testResults.id, failureId))
      .limit(1);

    if (failure.length === 0 || !failure[0].failureSignature) {
      return { suggestion: null, message: "Failure not found or no signature" };
    }

    // Find tests with similar failure signatures
    const similar = await db
      .select({
        testId: testResults.testId,
        failureSignature: testResults.failureSignature,
        count: sql<number>`count(*)`,
      })
      .from(testResults)
      .where(sql`${testResults.failureSignature} IS NOT NULL`)
      .groupBy(testResults.testId, testResults.failureSignature)
      .orderBy(desc(sql`count(*)`))
      .limit(5);

    return {
      suggestion: {
        similarFailures: similar,
        message:
          "ML service unavailable — showing basic signature-based matches",
      },
    };
  });

  // GET /api/insights/trends — trend signals (FR-23)
  app.get("/insights/trends", async () => {
    // Duration trend: average duration per run over last 30 runs
    const durationTrend = await db
      .select({
        runId: testResults.runId,
        avgDuration: sql<number>`avg(${testResults.durationMs})`,
        testCount: sql<number>`count(*)`,
        createdAt: sql<string>`min(${testResults.createdAt})`,
      })
      .from(testResults)
      .groupBy(testResults.runId)
      .orderBy(desc(sql`min(${testResults.createdAt})`))
      .limit(30);

    // Pass-rate trend: passed vs total per run over last 30 runs (#11).
    const passRateTrend = await db
      .select({
        runId: testResults.runId,
        total: sql<number>`count(*)`,
        passed: sql<number>`count(*) filter (where ${testResults.status} = 'passed')`,
        failed: sql<number>`count(*) filter (where ${testResults.status} = 'failed')`,
        createdAt: sql<string>`min(${testResults.createdAt})`,
      })
      .from(testResults)
      .groupBy(testResults.runId)
      .orderBy(desc(sql`min(${testResults.createdAt})`))
      .limit(30);

    // Flakiness trend: tests with flakiness above threshold
    const flakyTests = await db
      .select()
      .from(testHealth)
      .where(sql`${testHealth.flakinessScore} > 0.1`)
      .orderBy(desc(testHealth.flakinessScore));

    return { durationTrend, passRateTrend, flakyTests };
  });
};
