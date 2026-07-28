/**
 * API client — all calls to the control plane.
 */

const BASE = "/api";

/** Identity header derived from the logged-in user (see rbac.ts on the server). */
function authHeaders(): Record<string, string> {
  try {
    const raw = localStorage.getItem("user");
    if (!raw) return {};
    const user = JSON.parse(raw) as { id?: string };
    return user?.id ? { "x-user-id": user.id } : {};
  } catch {
    return {};
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(),
      ...init?.headers,
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API ${res.status}: ${text}`);
  }
  return res.json();
}

// ── Runs ──

export interface Run {
  id: string;
  triggerSource: string;
  commitSha: string;
  grafanaVersion: string;
  selector: string;
  status: string;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
}

export interface RunStats {
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  flaky: number;
}

export interface TestResult {
  id: string;
  runId: string;
  testId: string;
  status: string;
  durationMs: number | null;
  retryCount: number;
  failureSignature: string | null;
  clusterId: string | null;
  createdAt: string;
}

export type ArtifactViewer = "image" | "video" | "text" | "trace" | "download";

export interface Artifact {
  id: string;
  testResultId: string;
  kind: string;
  objectUri: string;
  viewer?: ArtifactViewer;
}

export interface AuditEntry {
  id: string;
  actorId: string | null;
  actorEmail: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  detail: string | null;
  createdAt: string;
}

/** A single similar historical failure returned by triage (#12). */
export interface SimilarFailure {
  test_id?: string;
  testId?: string;
  failure_signature?: string;
  failureSignature?: string;
  similarity?: number;
  commit_sha?: string;
  created_at?: string;
  count?: number;
}

/**
 * Triage response — the ML service returns `{ target_test_id, similar_failures }`;
 * the DB fallback returns `{ suggestion: { similarFailures, message } }`. Either
 * shape may include a `message` when no data is available.
 */
export interface TriageResponse {
  target_test_id?: string;
  similar_failures?: SimilarFailure[];
  suggestion?: {
    similarFailures?: SimilarFailure[];
    message?: string;
  } | null;
  message?: string;
}

export interface AuthProfileInfo {
  id: string;
  name: string;
  kind: "basic" | "token" | "storage_state";
  targetUrl: string | null;
  username: string | null;
  hasSecret: boolean;
  hasStorageState: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface UserInfo {
  id: string;
  email: string;
  name: string;
  role: string;
  active: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

export interface ScheduleInfo {
  id: string;
  name: string;
  cronExpression: string;
  selector: string;
  grafanaVersion: string;
  enabled: boolean;
  createdBy: string | null;
  lastRunAt: string | null;
  nextRunAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export const api = {
  // Config
  getConfig: () =>
    request<Record<string, string>>("/config"),

  updateConfig: (body: Record<string, string>) =>
    request<Record<string, string>>("/config", {
      method: "PUT",
      body: JSON.stringify(body),
    }),

  // Runs
  getRuns: (limit = 50, status?: string) =>
    request<{ runs: Run[] }>(
      `/runs?limit=${limit}${status ? `&status=${status}` : ""}`
    ),

  getRun: (id: string) =>
    request<{ run: Run; stats: RunStats }>(`/runs/${id}`),

  getRunResults: (id: string) =>
    request<{ results: TestResult[] }>(`/runs/${id}/results`),

  getRunLogs: (id: string, after = 0) =>
    request<{
      logs: { seq: number; stream: string; message: string; createdAt: string }[];
      lastSeq: number;
    }>(`/runs/${id}/logs?after=${after}`),

  deleteRun: (id: string) =>
    request<{ message: string; id: string }>(`/runs/${id}`, {
      method: "DELETE",
    }),

  triggerRun: (body: {
    selector?: string;
    testIds?: string[];
    grafanaVersion?: string;
    envOverrides?: {
      viewportWidth?: number;
      viewportHeight?: number;
      timezone?: string;
      timeFrom?: string;
      timeTo?: string;
    };
    commitSha?: string;
    triggerSource?: string;
    targetUrl?: string;
    authType?: "none" | "basic" | "token";
    authUsername?: string;
    authPassword?: string;
    authToken?: string;
    shards?: number;
  }) =>
    request<{ runId: string; status: string }>("/runs", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  // Artifacts
  getArtifacts: (resultId: string) =>
    request<{ artifacts: Artifact[] }>(`/results/${resultId}/artifacts`),

  getArtifactUrl: (artifactId: string) =>
    request<{ id: string; kind: string; viewer: ArtifactViewer; url: string }>(
      `/artifacts/${artifactId}/url`
    ),

  // Tests
  getTestHistory: (testId: string, limit = 200) =>
    request<{ testId: string; history: (TestResult & { commitSha: string; grafanaVersion: string })[] }>(
      `/tests/${encodeURIComponent(testId)}/history?limit=${limit}`
    ),

  getTestCatalog: () =>
    request<{
      tests: {
        testId: string;
        lastStatus: string;
        runCount: number;
        avgDurationMs: number;
        lastRun: string;
        testType: string;
        derivedType: string;
        overridden: boolean;
      }[];
    }>("/tests/catalog"),

  getAppTests: () =>
    request<{
      tests: {
        testId: string;
        file: string;
        title: string;
        caseName: string;
        derivedType: string;
        testType: string;
        overridden: boolean;
      }[];
    }>("/tests/app-tests"),

  // Raw script source for a spec file, to display in the catalog (view script).
  getTestSource: (file: string) =>
    request<{ file: string; content: string }>(
      `/tests/source?file=${encodeURIComponent(file)}`
    ),

  setTestType: (body: { testId: string; testType: string }) =>
    request<{ testId: string; testType: string }>("/tests/type", {
      method: "PUT",
      body: JSON.stringify(body),
    }),

  deleteAppTest: (body: { file: string }) =>
    request<{ deleted: string }>("/tests/app-tests", {
      method: "DELETE",
      body: JSON.stringify(body),
    }),

  // Remove a single test() by testId; deletes the file if it becomes empty (#5).
  deleteSingleTest: (body: { testId: string }) =>
    request<{ deleted: string; file: string; remaining: number; fileDeleted: boolean }>(
      "/tests/single",
      { method: "DELETE", body: JSON.stringify(body) }
    ),

  // Rename a single test's title in place; migrates override + health (#7).
  renameTest: (body: { testId: string; newTitle: string }) =>
    request<{ renamed: string; newTestId: string; file: string }>("/tests/rename", {
      method: "PATCH",
      body: JSON.stringify(body),
    }),

  // ML flakiness/quarantine map for badges (#10).
  getTestHealth: () =>
    request<{
      health: Record<
        string,
        { flakinessScore: number; quarantined: boolean; updatedAt: string }
      >;
    }>("/tests/health"),

  // Targets
  preflightTarget: (body: {
    targetUrl: string;
    authType?: "none" | "basic" | "token";
    authUsername?: string;
    authPassword?: string;
    authToken?: string;
  }) =>
    request<{
      reachable: boolean;
      authenticated: boolean | null;
      status: number;
      message: string;
    }>("/targets/preflight", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  uploadTest: (body: { fileName: string; content: string; testType?: string }) =>
    request<{
      file: string;
      replaced: boolean;
      testCount: number;
      derivedType: string;
      testType: string;
      tests: { testId: string; title: string }[];
    }>("/tests/upload", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  // Insights
  getQuarantine: () =>
    request<{
      quarantined: {
        testId: string;
        flakinessScore: number;
        quarantined: boolean;
        updatedAt: string;
      }[];
    }>("/insights/quarantine"),

  getClusters: (runId?: string) =>
    request<{
      clusters: {
        id: string;
        representative: string;
        size: number;
        first_seen: string;
        last_seen: string;
      }[];
    }>(`/insights/clusters${runId ? `?runId=${runId}` : ""}`),

  getTriage: (failureId: string) =>
    request<TriageResponse>(`/insights/triage?failureId=${failureId}`),

  getTrends: () =>
    request<{
      durationTrend: { runId: string; avgDuration: number; testCount: number; createdAt: string }[];
      passRateTrend: {
        runId: string;
        total: number;
        passed: number;
        failed: number;
        createdAt: string;
      }[];
      flakyTests: { testId: string; flakinessScore: number; quarantined: boolean }[];
    }>("/insights/trends"),

  // Generate
  generate: (body: {
    dashboardUid?: string;
    dashboardJson?: unknown;
    useLlm?: boolean;
    testType?: string;
    targetUrl?: string;
    authType?: "none" | "basic" | "token";
    authUsername?: string;
    authPassword?: string;
    authToken?: string;
  }) =>
    request<{ prUrl: string | null; filesGenerated: string[] }>("/generate", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  // Users
  getUsers: () =>
    request<{ users: UserInfo[] }>("/users"),

  createUser: (body: { email: string; name: string; password: string; role?: string }) =>
    request<{ id: string; email: string; name: string; role: string }>("/users", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  updateUser: (id: string, body: { name?: string; role?: string; active?: boolean; password?: string }) =>
    request<{ message: string; id: string }>(`/users/${id}`, {
      method: "PUT",
      body: JSON.stringify(body),
    }),

  deleteUser: (id: string) =>
    request<{ message: string; id: string }>(`/users/${id}`, { method: "DELETE" }),

  registerUser: (body: { email: string; name: string; password: string }) =>
    request<{ id: string; email: string; name: string; role: string; message: string }>("/users/register", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  loginUser: (body: { email: string; password: string }) =>
    request<{ user: { id: string; email: string; name: string; role: string }; message: string }>("/users/login", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  resetPassword: (body: { email: string; newPassword: string }) =>
    request<{ message: string }>("/users/reset-password", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  // Schedules
  getSchedules: () =>
    request<{ schedules: ScheduleInfo[] }>("/schedules"),

  createSchedule: (body: {
    name: string;
    cronExpression: string;
    selector?: string;
    testIds?: string[];
    grafanaVersion?: string;
    targetUrl?: string;
    authType?: "none" | "basic" | "token";
    authUsername?: string;
    authPassword?: string;
    authToken?: string;
  }) =>
    request<{ id: string; name: string; cronExpression: string }>("/schedules", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  updateSchedule: (id: string, body: { name?: string; cronExpression?: string; selector?: string; grafanaVersion?: string; enabled?: boolean }) =>
    request<{ message: string; id: string }>(`/schedules/${id}`, {
      method: "PUT",
      body: JSON.stringify(body),
    }),

  deleteSchedule: (id: string) =>
    request<{ message: string; id: string }>(`/schedules/${id}`, { method: "DELETE" }),

  triggerSchedule: (id: string) =>
    request<{ runId: string; scheduleId: string; status: string }>(`/schedules/${id}/run`, {
      method: "POST",
    }),

  // Audit log (#19)
  getAudit: (limit = 100) =>
    request<{ entries: AuditEntry[] }>(`/audit?limit=${limit}`),

  // Auth profiles (#1/#2)
  getAuthProfiles: () =>
    request<{ profiles: AuthProfileInfo[] }>("/auth-profiles"),

  createAuthProfile: (body: {
    name: string;
    kind: "basic" | "token" | "storage_state";
    targetUrl?: string;
    username?: string;
    secret?: string;
    storageState?: string;
  }) =>
    request<{ profile: AuthProfileInfo }>("/auth-profiles", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  deleteAuthProfile: (id: string) =>
    request<{ message: string; id: string }>(`/auth-profiles/${id}`, {
      method: "DELETE",
    }),
};
