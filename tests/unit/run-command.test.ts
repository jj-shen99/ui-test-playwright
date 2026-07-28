/**
 * Unit tests for orchestrator run-command helpers:
 * escapeRegex, buildGrepArgs, buildTargetEnv.
 *
 * Techniques: equivalence partitioning, boundary values (0/1/N tests),
 * decision table (auth type × field presence), security (regex injection).
 */

import { describe, it, expect } from "vitest";
import {
  escapeRegex,
  buildGrepArgs,
  buildPlaywrightArgs,
  buildQuarantineArgs,
  buildRunEnvOverrides,
  buildTargetEnv,
  resolveShardCount,
  buildShardPlan,
  mergeShardStatuses,
  MAX_SHARDS,
  KNOWN_TEST_TYPES,
} from "../../services/orchestrator/run-command";

describe("escapeRegex", () => {
  it("escapes regex metacharacters", () => {
    expect(escapeRegex("a.b*c+")).toBe("a\\.b\\*c\\+");
  });

  it("escapes parentheses and pipes (grep-breaking chars)", () => {
    expect(escapeRegex("(a|b)")).toBe("\\(a\\|b\\)");
  });

  it("leaves plain text unchanged", () => {
    expect(escapeRegex("dashboard link visible")).toBe("dashboard link visible");
  });

  it("handles empty string", () => {
    expect(escapeRegex("")).toBe("");
  });
});

describe("buildGrepArgs", () => {
  // ── testIds branch (highest precedence) ──

  it("returns no args for 'all' with no testIds", () => {
    expect(buildGrepArgs("all")).toEqual([]);
  });

  it("greps a single test by its title (after ::)", () => {
    expect(
      buildGrepArgs("all", ["app_tests/x.spec.ts::dashboard link control is visible"])
    ).toEqual(["--grep", "(dashboard link control is visible)"]);
  });

  it("greps multiple tests joined with | (N tests boundary)", () => {
    expect(
      buildGrepArgs("all", ["f.spec.ts::alpha", "f.spec.ts::beta"])
    ).toEqual(["--grep", "(alpha|beta)"]);
  });

  it("escapes regex chars in individual test titles (security)", () => {
    expect(buildGrepArgs("all", ["f.spec.ts::a (b) c.d"])).toEqual([
      "--grep",
      "(a \\(b\\) c\\.d)",
    ]);
  });

  it("falls back to the raw id when there is no :: separator", () => {
    expect(buildGrepArgs("all", ["justatitle"])).toEqual(["--grep", "(justatitle)"]);
  });

  it("testIds take precedence over a type selector", () => {
    expect(buildGrepArgs("smoke", ["f.spec.ts::x"])).toEqual(["--grep", "(x)"]);
  });

  // ── known type branch ──

  it.each(KNOWN_TEST_TYPES)("greps @%s for a known type selector", (type) => {
    expect(buildGrepArgs(type)).toEqual(["--grep", `@${type}`]);
  });

  // ── single testId selector branch ──

  it("greps by title when selector itself is a testId", () => {
    expect(buildGrepArgs("f.spec.ts::my test")).toEqual(["--grep", "my test"]);
  });

  it("escapes a testId selector's title", () => {
    expect(buildGrepArgs("f.spec.ts::a+b")).toEqual(["--grep", "a\\+b"]);
  });

  // ── empty testIds should not trigger the testIds branch ──

  it("treats empty testIds array as no filter", () => {
    expect(buildGrepArgs("all", [])).toEqual([]);
  });
});

describe("buildTargetEnv", () => {
  // ── decision table: target presence × auth type × field presence ──

  it("returns empty object when no target", () => {
    expect(buildTargetEnv(undefined)).toEqual({});
  });

  it("returns empty object when target has no url", () => {
    expect(buildTargetEnv({ url: "" })).toEqual({});
  });

  it("sets URL envs with authType none", () => {
    expect(buildTargetEnv({ url: "https://g.example.com", authType: "none" })).toEqual({
      GRAFANA_URL: "https://g.example.com",
      VM_GRAFANA_URL: "https://g.example.com",
    });
  });

  it("sets user + password for basic auth", () => {
    expect(
      buildTargetEnv({
        url: "https://g.example.com",
        authType: "basic",
        username: "admin",
        password: "secret",
      })
    ).toEqual({
      GRAFANA_URL: "https://g.example.com",
      VM_GRAFANA_URL: "https://g.example.com",
      GRAFANA_USER: "admin",
      VM_GRAFANA_USER: "admin",
      GRAFANA_PASSWORD: "secret",
      VM_GRAFANA_PASSWORD: "secret",
    });
  });

  it("sets user but not password when password missing (basic)", () => {
    const env = buildTargetEnv({
      url: "https://g.example.com",
      authType: "basic",
      username: "admin",
    });
    expect(env.GRAFANA_USER).toBe("admin");
    expect(env.GRAFANA_PASSWORD).toBeUndefined();
  });

  it("does not set user when username missing (basic)", () => {
    const env = buildTargetEnv({ url: "https://g.example.com", authType: "basic" });
    expect(env.GRAFANA_USER).toBeUndefined();
    expect(env.GRAFANA_URL).toBe("https://g.example.com");
  });

  it("sets token envs for token auth", () => {
    expect(
      buildTargetEnv({ url: "https://g.example.com", authType: "token", token: "tok_123" })
    ).toMatchObject({
      GRAFANA_TOKEN: "tok_123",
      VM_GRAFANA_TOKEN: "tok_123",
    });
  });

  it("does not set token when token missing", () => {
    const env = buildTargetEnv({ url: "https://g.example.com", authType: "token" });
    expect(env.GRAFANA_TOKEN).toBeUndefined();
  });

  it("ignores basic credentials when authType is token", () => {
    const env = buildTargetEnv({
      url: "https://g.example.com",
      authType: "token",
      username: "admin",
      password: "secret",
      token: "tok",
    });
    expect(env.GRAFANA_USER).toBeUndefined();
    expect(env.GRAFANA_PASSWORD).toBeUndefined();
    expect(env.GRAFANA_TOKEN).toBe("tok");
  });
});

describe("buildPlaywrightArgs", () => {
  it("pins the config so runs look under app_tests/", () => {
    const args = buildPlaywrightArgs({
      config: "app_tests/playwright.config.ts",
      selector: "all",
    });
    expect(args).toEqual([
      "playwright",
      "test",
      "--config=app_tests/playwright.config.ts",
    ]);
  });

  it("appends a type --grep after the config", () => {
    const args = buildPlaywrightArgs({
      config: "app_tests/playwright.config.ts",
      selector: "smoke",
    });
    expect(args).toEqual([
      "playwright",
      "test",
      "--config=app_tests/playwright.config.ts",
      "--grep",
      "@smoke",
    ]);
  });

  it("combines config, individual-test grep, and shard", () => {
    const args = buildPlaywrightArgs({
      config: "app_tests/playwright.config.ts",
      selector: "all",
      testIds: ["app_tests/a.spec.ts::renders panel"],
      shard: "1/2",
    });
    expect(args).toEqual([
      "playwright",
      "test",
      "--config=app_tests/playwright.config.ts",
      "--grep",
      "(renders panel)",
      "--shard=1/2",
    ]);
  });

  it("omits the config flag when none is provided", () => {
    const args = buildPlaywrightArgs({ selector: "all" });
    expect(args).toEqual(["playwright", "test"]);
  });

  it("omits the shard flag when not provided", () => {
    const args = buildPlaywrightArgs({ config: "c.ts", selector: "all" });
    expect(args).not.toContain("--shard");
  });

  it("appends a quarantine grep-invert after the selector grep", () => {
    const args = buildPlaywrightArgs({
      config: "c.ts",
      selector: "smoke",
      quarantine: ["app_tests/a.spec.ts::flaky one"],
    });
    expect(args).toEqual([
      "playwright",
      "test",
      "--config=c.ts",
      "--grep",
      "@smoke",
      "--grep-invert",
      "(flaky one)",
    ]);
  });
});

describe("buildQuarantineArgs (#14)", () => {
  it("returns [] when there is nothing quarantined", () => {
    expect(buildQuarantineArgs()).toEqual([]);
    expect(buildQuarantineArgs([])).toEqual([]);
  });

  it("greps-invert by title, stripping the file:: prefix", () => {
    expect(
      buildQuarantineArgs(["app_tests/a.spec.ts::flaky one", "bare title"])
    ).toEqual(["--grep-invert", "(flaky one|bare title)"]);
  });

  it("escapes regex metacharacters in quarantined titles", () => {
    expect(buildQuarantineArgs(["a::b (c)"])).toEqual([
      "--grep-invert",
      "(b \\(c\\))",
    ]);
  });

  it("does NOT exclude a title the user explicitly selected", () => {
    // Explicit selection wins over auto-quarantine.
    expect(
      buildQuarantineArgs(
        ["app_tests/a.spec.ts::flaky one"],
        ["app_tests/a.spec.ts::flaky one"]
      )
    ).toEqual([]);
  });

  it("de-duplicates repeated quarantined titles", () => {
    expect(buildQuarantineArgs(["x::same", "y::same"])).toEqual([
      "--grep-invert",
      "(same)",
    ]);
  });

  it("drops blank titles", () => {
    expect(buildQuarantineArgs(["x::", "   "])).toEqual([]);
  });
});

describe("buildRunEnvOverrides (#15)", () => {
  it("returns {} for undefined / empty overrides", () => {
    expect(buildRunEnvOverrides()).toEqual({});
    expect(buildRunEnvOverrides({})).toEqual({});
  });

  it("sets viewport only when BOTH dimensions are valid integers", () => {
    expect(buildRunEnvOverrides({ viewportWidth: 1280, viewportHeight: 720 })).toEqual({
      RUN_VIEWPORT_WIDTH: "1280",
      RUN_VIEWPORT_HEIGHT: "720",
    });
    expect(buildRunEnvOverrides({ viewportWidth: 1280 })).toEqual({});
    expect(buildRunEnvOverrides({ viewportHeight: 720 })).toEqual({});
  });

  it("rejects out-of-range and non-integer viewport values", () => {
    expect(buildRunEnvOverrides({ viewportWidth: 10, viewportHeight: 720 })).toEqual({});
    expect(buildRunEnvOverrides({ viewportWidth: 1280.5, viewportHeight: 720 })).toEqual({});
    expect(buildRunEnvOverrides({ viewportWidth: 99999, viewportHeight: 720 })).toEqual({});
  });

  it("accepts browser/utc and IANA timezones, rejects junk", () => {
    expect(buildRunEnvOverrides({ timezone: "utc" }).RUN_TIMEZONE).toBe("utc");
    expect(buildRunEnvOverrides({ timezone: "browser" }).RUN_TIMEZONE).toBe("browser");
    expect(buildRunEnvOverrides({ timezone: "America/New_York" }).RUN_TIMEZONE).toBe(
      "America/New_York"
    );
    expect(buildRunEnvOverrides({ timezone: "not a tz!" }).RUN_TIMEZONE).toBeUndefined();
  });

  it("accepts relative and absolute time values, rejects junk", () => {
    expect(buildRunEnvOverrides({ timeFrom: "now-6h", timeTo: "now" })).toEqual({
      RUN_TIME_FROM: "now-6h",
      RUN_TIME_TO: "now",
    });
    expect(buildRunEnvOverrides({ timeFrom: "1700000000000" }).RUN_TIME_FROM).toBe(
      "1700000000000"
    );
    expect(buildRunEnvOverrides({ timeFrom: "yesterday" }).RUN_TIME_FROM).toBeUndefined();
  });

  it("trims whitespace around accepted values", () => {
    expect(buildRunEnvOverrides({ timezone: "  utc  " }).RUN_TIMEZONE).toBe("utc");
    expect(buildRunEnvOverrides({ timeFrom: "  now-1d  " }).RUN_TIME_FROM).toBe("now-1d");
  });
});

// ─────────────────────────── Parallel sharding (#13) ───────────────────────────

describe("resolveShardCount", () => {
  // Equivalence partitions: unset, <=1, in-range, over-max, non-numeric.
  it("treats missing/undefined/null as no sharding (1)", () => {
    expect(resolveShardCount(undefined)).toBe(1);
    expect(resolveShardCount(null)).toBe(1);
  });

  it("treats 0, 1, and negatives as no sharding (1)", () => {
    expect(resolveShardCount(0)).toBe(1);
    expect(resolveShardCount(1)).toBe(1);
    expect(resolveShardCount(-4)).toBe(1);
  });

  it("passes through valid in-range counts", () => {
    expect(resolveShardCount(2)).toBe(2);
    expect(resolveShardCount(8)).toBe(8);
  });

  it("caps at MAX_SHARDS", () => {
    expect(resolveShardCount(1000)).toBe(MAX_SHARDS);
  });

  it("floors fractional values", () => {
    expect(resolveShardCount(3.9)).toBe(3);
  });

  it("parses numeric strings and rejects junk", () => {
    expect(resolveShardCount("4")).toBe(4);
    expect(resolveShardCount("not-a-number")).toBe(1);
    expect(resolveShardCount("")).toBe(1);
  });
});

describe("buildShardPlan", () => {
  const base = { config: "app_tests/playwright.config.ts", selector: "all" };

  it("returns a single unsharded plan for count <= 1", () => {
    const plan = buildShardPlan(base, 1);
    expect(plan).toHaveLength(1);
    expect(plan[0].shard).toBeNull();
    expect(plan[0].args).not.toContain("--shard=1/1");
    expect(plan[0].args.some((a) => a.startsWith("--shard="))).toBe(false);
  });

  it("produces one arg list per shard with the correct --shard flags", () => {
    const plan = buildShardPlan(base, 3);
    expect(plan.map((p) => p.shard)).toEqual(["1/3", "2/3", "3/3"]);
    expect(plan.map((p) => p.index)).toEqual([0, 1, 2]);
    for (const p of plan) {
      expect(p.args).toContain(`--shard=${p.shard}`);
      expect(p.args).toContain("--config=app_tests/playwright.config.ts");
    }
  });

  it("carries selector/grep and quarantine filters into every shard", () => {
    const plan = buildShardPlan(
      { ...base, selector: "smoke", quarantine: ["file::flaky one"] },
      2
    );
    for (const p of plan) {
      expect(p.args).toContain("--grep");
      expect(p.args).toContain("--grep-invert");
    }
  });

  it("caps the number of shards at MAX_SHARDS", () => {
    const plan = buildShardPlan(base, 999);
    expect(plan).toHaveLength(MAX_SHARDS);
    expect(plan[0].shard).toBe(`1/${MAX_SHARDS}`);
  });
});

describe("mergeShardStatuses", () => {
  it("passes only when every shard exited 0", () => {
    expect(mergeShardStatuses([0, 0, 0])).toBe("passed");
  });

  it("fails when any shard exited non-zero", () => {
    expect(mergeShardStatuses([0, 1, 0])).toBe("failed");
    expect(mergeShardStatuses([1])).toBe("failed");
  });

  it("treats an empty list (nothing ran) as failed", () => {
    expect(mergeShardStatuses([])).toBe("failed");
  });
});
