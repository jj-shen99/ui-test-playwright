/**
 * Pure helpers for translating a run's selector / target into Playwright
 * invocation details. Extracted from the orchestrator worker so they can be
 * unit-tested without starting the BullMQ worker or its side effects.
 */

export interface RunTarget {
  url: string;
  authType?: "none" | "basic" | "token";
  username?: string;
  password?: string;
  token?: string;
  /**
   * A captured Playwright storageState JSON (SSO session injection, #1). When
   * present, the orchestrator writes it into the cloned run dir so the auth
   * setup can reuse the session instead of performing an interactive login.
   */
  storageState?: string;
}

/** Path (relative to the cloned test repo) where app_tests reads its auth state. */
export const AUTH_STATE_REL_PATH = "app_tests/fixtures/auth-state.json";

/** Resolve the absolute auth-state path inside a cloned run directory. */
export function resolveAuthStatePath(cloneDir: string): string {
  // Use POSIX join semantics via manual concatenation to stay pure/testable.
  return `${cloneDir.replace(/\/+$/, "")}/${AUTH_STATE_REL_PATH}`;
}

export const KNOWN_TEST_TYPES = ["smoke", "sanity", "regression", "e2e"];

/** Escape a string for safe inclusion in a Playwright --grep regex. */
export function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Translate a run's selector / testIds into Playwright CLI args.
 * - Individual tests → --grep "(title1|title2)"
 * - A known type (smoke/sanity/…) → --grep @type
 * - A single testId selector (contains "::") → --grep by its title
 * - Otherwise (all) → no filter
 */
export function buildGrepArgs(selector: string, testIds?: string[]): string[] {
  if (testIds && testIds.length > 0) {
    const titles = testIds.map((id) => {
      const idx = id.indexOf("::");
      return escapeRegex(idx >= 0 ? id.slice(idx + 2) : id);
    });
    return ["--grep", `(${titles.join("|")})`];
  }
  if (KNOWN_TEST_TYPES.includes(selector)) {
    return ["--grep", `@${selector}`];
  }
  if (selector.includes("::")) {
    const title = selector.slice(selector.indexOf("::") + 2);
    return ["--grep", escapeRegex(title)];
  }
  return [];
}

/**
 * Build a `--grep-invert` filter that excludes quarantined tests (#14).
 *
 * `quarantine` holds testIds (`file::title`) or bare titles; we grep-invert by
 * title so Playwright skips known-flaky tests. Any titles that also appear in
 * `keepTitles` (an explicit user selection) are NOT excluded — an explicit
 * request to run a specific test wins over auto-quarantine. Returns [] when
 * there is nothing to exclude.
 */
export function buildQuarantineArgs(
  quarantine?: string[],
  keepTitles?: string[]
): string[] {
  if (!quarantine || quarantine.length === 0) return [];
  const keep = new Set(
    (keepTitles ?? []).map((id) => {
      const idx = id.indexOf("::");
      return idx >= 0 ? id.slice(idx + 2) : id;
    })
  );
  const titles = quarantine
    .map((id) => {
      const idx = id.indexOf("::");
      return idx >= 0 ? id.slice(idx + 2) : id;
    })
    .filter((t) => t.trim().length > 0 && !keep.has(t));
  const unique = Array.from(new Set(titles));
  if (unique.length === 0) return [];
  return ["--grep-invert", `(${unique.map(escapeRegex).join("|")})`];
}

/**
 * Compose the full `playwright test` argument list.
 * Pins the config (so runs look under app_tests/) and appends selector/grep,
 * an optional quarantine grep-invert, and optional shard args.
 */
export function buildPlaywrightArgs(opts: {
  config?: string;
  selector: string;
  testIds?: string[];
  quarantine?: string[];
  shard?: string;
}): string[] {
  const args = ["playwright", "test"];
  if (opts.config) args.push(`--config=${opts.config}`);
  args.push(...buildGrepArgs(opts.selector, opts.testIds));
  args.push(...buildQuarantineArgs(opts.quarantine, opts.testIds));
  if (opts.shard) args.push(`--shard=${opts.shard}`);
  return args;
}

/** Upper bound on shards so a bad request can't fork a huge number of processes. */
export const MAX_SHARDS = 16;

/**
 * Clamp a requested shard count into a safe range (#13). Non-numeric, missing,
 * or <=1 values mean "no sharding" (returns 1). Values above MAX_SHARDS are
 * capped. Fractions are floored.
 */
export function resolveShardCount(requested?: number | string | null): number {
  const n = typeof requested === "string" ? Number(requested) : requested;
  if (typeof n !== "number" || !Number.isFinite(n)) return 1;
  const floored = Math.floor(n);
  if (floored <= 1) return 1;
  return Math.min(floored, MAX_SHARDS);
}

/**
 * Produce the per-shard Playwright arg lists for a run split across `total`
 * shards (#13). Each shard gets its own `--shard=i/total`. When `total <= 1`,
 * returns a single arg list with no shard flag (unsharded). Merging is implicit:
 * every shard runs with the same RUN_ID and writes a disjoint slice of results
 * to the same run row.
 */
export function buildShardPlan(
  opts: {
    config?: string;
    selector: string;
    testIds?: string[];
    quarantine?: string[];
  },
  total: number
): { shard: string | null; index: number; args: string[] }[] {
  const count = resolveShardCount(total);
  if (count <= 1) {
    return [{ shard: null, index: 0, args: buildPlaywrightArgs(opts) }];
  }
  const plan: { shard: string | null; index: number; args: string[] }[] = [];
  for (let i = 1; i <= count; i++) {
    const shard = `${i}/${count}`;
    plan.push({ shard, index: i - 1, args: buildPlaywrightArgs({ ...opts, shard }) });
  }
  return plan;
}

/**
 * Merge shard exit codes into a single run status (#13). The run passes only if
 * every shard exited 0; otherwise it failed. An empty list is treated as failed
 * (nothing ran). Pure and unit-testable.
 */
export function mergeShardStatuses(codes: number[]): "passed" | "failed" {
  if (codes.length === 0) return "failed";
  return codes.every((c) => c === 0) ? "passed" : "failed";
}

/**
 * Optional per-run environment overrides (#15). All fields are optional; the
 * UI/route pass through whatever the user set. Time-range values accept either
 * a Grafana relative expression (e.g. "now-6h") or an absolute epoch-ms string.
 */
export interface RunEnvOverrides {
  viewportWidth?: number;
  viewportHeight?: number;
  timezone?: string;
  timeFrom?: string;
  timeTo?: string;
}

/** Grafana timezone tokens plus IANA-style "Area/Location" identifiers. */
function isValidTimezone(tz: string): boolean {
  if (tz === "browser" || tz === "utc" || tz === "UTC") return true;
  return /^[A-Za-z]+\/[A-Za-z0-9_+\-/]+$/.test(tz);
}

/** A Grafana time value: relative ("now", "now-6h") or an absolute epoch-ms. */
function isValidTimeValue(v: string): boolean {
  return /^now(?:[-+]\d+[smhdwMy])?(?:\/[smhdwMy])?$/.test(v) || /^\d{10,}$/.test(v);
}

/**
 * Translate per-run overrides into environment variables consumed by the
 * Playwright config / page object. Invalid or empty values are dropped so a
 * malformed override never poisons the run env. Pure and unit-testable.
 */
export function buildRunEnvOverrides(
  overrides?: RunEnvOverrides
): Record<string, string> {
  if (!overrides) return {};
  const env: Record<string, string> = {};

  const w = overrides.viewportWidth;
  const h = overrides.viewportHeight;
  // Require BOTH dimensions to be sane positive integers, or set neither.
  if (
    typeof w === "number" && Number.isInteger(w) && w >= 320 && w <= 7680 &&
    typeof h === "number" && Number.isInteger(h) && h >= 240 && h <= 4320
  ) {
    env.RUN_VIEWPORT_WIDTH = String(w);
    env.RUN_VIEWPORT_HEIGHT = String(h);
  }

  if (overrides.timezone && isValidTimezone(overrides.timezone.trim())) {
    env.RUN_TIMEZONE = overrides.timezone.trim();
  }
  if (overrides.timeFrom && isValidTimeValue(overrides.timeFrom.trim())) {
    env.RUN_TIME_FROM = overrides.timeFrom.trim();
  }
  if (overrides.timeTo && isValidTimeValue(overrides.timeTo.trim())) {
    env.RUN_TIME_TO = overrides.timeTo.trim();
  }
  return env;
}

/** Build environment overrides so tests run against a remote target with auth. */
export function buildTargetEnv(target?: RunTarget): Record<string, string> {
  if (!target?.url) return {};
  const env: Record<string, string> = {
    GRAFANA_URL: target.url,
    VM_GRAFANA_URL: target.url,
  };
  if (target.authType === "basic" && target.username) {
    env.GRAFANA_USER = target.username;
    env.VM_GRAFANA_USER = target.username;
    if (target.password) {
      env.GRAFANA_PASSWORD = target.password;
      env.VM_GRAFANA_PASSWORD = target.password;
    }
  } else if (target.authType === "token" && target.token) {
    env.GRAFANA_TOKEN = target.token;
    env.VM_GRAFANA_TOKEN = target.token;
  }
  // SSO session injection (#1): signal the auth setup to reuse the pre-written
  // storageState file instead of attempting an interactive/form login.
  if (target.storageState) {
    env.AUTH_STATE_INJECTED = "1";
  }
  return env;
}
