/**
 * Target pre-flight route (enhancement #4).
 *
 * POST /api/targets/preflight — verify a target Grafana is reachable and, when
 * credentials are supplied, that they authenticate — before queueing a full run.
 * Best-effort: SSO-fronted instances that redirect to an IdP cannot be verified
 * with form/token auth and are reported as such rather than a false positive.
 */

import { type FastifyPluginAsync } from "fastify";

export interface TargetAuth {
  authType?: string;
  authUsername?: string;
  authPassword?: string;
  authToken?: string;
}

/** Reduce any URL to its http(s) origin, or null when invalid. */
export function toOrigin(raw: string): string | null {
  try {
    const u = new URL((raw ?? "").trim());
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.origin;
  } catch {
    return null;
  }
}

/** Build an Authorization header for the given auth config (pure). */
export function buildAuthHeader(auth: TargetAuth): Record<string, string> {
  if (auth.authType === "basic" && auth.authUsername) {
    const token = Buffer.from(
      `${auth.authUsername}:${auth.authPassword ?? ""}`
    ).toString("base64");
    return { Authorization: `Basic ${token}` };
  }
  if (auth.authType === "token" && auth.authToken) {
    return { Authorization: `Bearer ${auth.authToken}` };
  }
  return {};
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  ms: number
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

const TIMEOUT_MS = 8_000;

export const targetsRoutes: FastifyPluginAsync = async (app) => {
  app.post<{
    Body: TargetAuth & { targetUrl?: string };
  }>("/targets/preflight", async (request, reply) => {
    const { targetUrl, authType = "none", authUsername, authPassword, authToken } =
      request.body || {};

    const origin = toOrigin(targetUrl || "");
    if (!origin) {
      return reply.badRequest("A valid target URL (http/https) is required");
    }

    // 1) Reachability — Grafana exposes /api/health without auth.
    let healthStatus = 0;
    try {
      const res = await fetchWithTimeout(
        `${origin}/api/health`,
        { method: "GET" },
        TIMEOUT_MS
      );
      healthStatus = res.status;
    } catch (err) {
      return {
        reachable: false,
        authenticated: null,
        status: 0,
        message: `Could not reach ${origin}: ${
          err instanceof Error ? err.message : "network error"
        }`,
      };
    }

    // 2) Auth verification — only when credentials were supplied.
    const authHeader = buildAuthHeader({
      authType,
      authUsername,
      authPassword,
      authToken,
    });

    if (Object.keys(authHeader).length === 0) {
      return {
        reachable: true,
        authenticated: null,
        status: healthStatus,
        message: `Reachable (${origin}). No credentials provided to verify authentication.`,
      };
    }

    try {
      // redirect: "manual" so an SSO login redirect isn't mistaken for success.
      const res = await fetchWithTimeout(
        `${origin}/api/user`,
        { method: "GET", headers: authHeader, redirect: "manual" },
        TIMEOUT_MS
      );

      if (res.type === "opaqueredirect" || (res.status >= 300 && res.status < 400)) {
        return {
          reachable: true,
          authenticated: false,
          status: res.status,
          message: `${origin} redirected the auth check — it likely uses SSO, which cannot be verified with form/token credentials.`,
        };
      }

      const authenticated = res.ok;
      let message: string;
      if (authenticated) {
        message = `Authenticated successfully against ${origin}.`;
      } else if (res.status === 401) {
        message = `Credentials were rejected (401) by ${origin}.`;
      } else {
        message = `Auth check returned HTTP ${res.status} from ${origin}.`;
      }
      return { reachable: true, authenticated, status: res.status, message };
    } catch (err) {
      return {
        reachable: true,
        authenticated: null,
        status: 0,
        message: `Auth check failed: ${
          err instanceof Error ? err.message : "network error"
        }`,
      };
    }
  });
};
