/**
 * Generation API route.
 * POST /api/generate → generate tests from a dashboard (FR-1..6)
 */

import { type FastifyPluginAsync } from "fastify";

export const generateRoutes: FastifyPluginAsync = async (app) => {
  // POST /api/generate — kick off test generation from dashboard JSON
  app.post<{
    Body: {
      dashboardUid?: string;
      dashboardJson?: Record<string, unknown>;
      useLlm?: boolean;
      testType?: string;
      targetUrl?: string;
      authType?: "none" | "basic" | "token";
      authUsername?: string;
      authPassword?: string;
      authToken?: string;
    };
  }>("/generate", async (request, reply) => {
    const {
      dashboardUid,
      dashboardJson,
      useLlm = false,
      testType = "smoke",
      targetUrl,
      authType = "none",
      authUsername,
      authPassword,
      authToken,
    } = request.body || {};

    if (!dashboardUid && !dashboardJson) {
      return reply.badRequest(
        "Either dashboardUid or dashboardJson is required"
      );
    }

    // Dynamically import the generation service
    const { generateTests } = await import(
      "../../generation/generator"
    );

    try {
      const result = await generateTests({
        dashboardUid,
        dashboardJson,
        useLlm,
        testType,
        target: targetUrl
          ? {
              url: targetUrl,
              authType,
              username: authUsername,
              password: authPassword,
              token: authToken,
            }
          : undefined,
      });

      return { prUrl: result.prUrl, filesGenerated: result.files };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Generation failed";
      return reply.internalServerError(message);
    }
  });
};
