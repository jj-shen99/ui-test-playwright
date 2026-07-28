/**
 * Deterministic sample data for the results store (#25).
 *
 * Builds a set of runs, per-test results, and test-health rows so the UI
 * (/results, catalog, insights) has realistic data to render locally without
 * executing a full Playwright run. Pure and deterministic given a `now` anchor,
 * so it is unit-testable; the `scripts/seed-results.ts` wrapper performs the
 * actual database inserts.
 */

export interface FixtureRun {
  id: string;
  triggerSource: string;
  commitSha: string;
  grafanaVersion: string;
  selector: string;
  status: string;
  startedAt: Date;
  finishedAt: Date;
  createdAt: Date;
}

export interface FixtureTestResult {
  id: string;
  runId: string;
  testId: string;
  status: string;
  durationMs: number;
  retryCount: number;
  failureSignature: string | null;
  createdAt: Date;
}

export interface FixtureTestHealth {
  testId: string;
  flakinessScore: number;
  quarantined: boolean;
  updatedAt: Date;
}

export interface ResultsFixture {
  runs: FixtureRun[];
  testResults: FixtureTestResult[];
  testHealth: FixtureTestHealth[];
}

/** The sample tests referenced by the fixture (repo-relative testIds). */
export const FIXTURE_TESTS: { testId: string; baseMs: number }[] = [
  { testId: "app_tests/vm-cluster/panel-render.spec.ts::CPU usage panel renders", baseMs: 4200 },
  { testId: "app_tests/vm-cluster/panel-render.spec.ts::Memory panel renders", baseMs: 3800 },
  { testId: "app_tests/vm-cluster/variable-dropdown.spec.ts::instance dropdown filters series", baseMs: 5600 },
  { testId: "app_tests/vm-cluster/time-range.spec.ts::absolute time range loads data", baseMs: 6100 },
  { testId: "app_tests/vm-cluster/drilldown.spec.ts::panel drilldown opens explore", baseMs: 7300 },
];

const GRAFANA_VERSIONS = ["11.4.0", "11.3.1"];
const TRIGGERS = ["manual", "nightly", "pr"];

/** A stable UUIDv4-shaped id derived from a counter (deterministic). */
export function fixtureId(prefix: string, n: number): string {
  const hex = (n >>> 0).toString(16).padStart(12, "0");
  const p = prefix.slice(0, 8).padStart(8, "0");
  return `${p}-0000-4000-8000-${hex}`;
}

/** Deterministic pseudo-random in [0,1) from two integer seeds. */
function rand(a: number, b: number): number {
  const x = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return x - Math.floor(x);
}

/**
 * Build the full fixture. `runCount` runs are laid out one per day going
 * backwards from `now`, oldest last. A couple of tests are deliberately made
 * flaky/failing on some runs so trend and triage views have signal.
 */
export function buildResultsFixture(
  now: Date = new Date(),
  opts: { runCount?: number } = {}
): ResultsFixture {
  // Guard against undefined/NaN (e.g. a non-numeric --runs arg): `??` alone does
  // not catch NaN, so fall back to the default before clamping to [1, 60].
  const requested = Number.isFinite(opts.runCount as number)
    ? (opts.runCount as number)
    : 8;
  const runCount = Math.max(1, Math.min(Math.floor(requested), 60));
  const runs: FixtureRun[] = [];
  const testResults: FixtureTestResult[] = [];

  let resultCounter = 1;

  for (let i = 0; i < runCount; i++) {
    const runId = fixtureId("11111111", i + 1);
    const createdAt = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
    const startedAt = new Date(createdAt.getTime() + 2000);

    const perRun: FixtureTestResult[] = [];
    for (let t = 0; t < FIXTURE_TESTS.length; t++) {
      const { testId, baseMs } = FIXTURE_TESTS[t];
      const r = rand(i + 1, t + 1);

      // The drilldown test (index 4) is flaky; the time-range test (index 3)
      // fails on a couple of older runs to create a downward trend.
      let status: "passed" | "failed" | "flaky" = "passed";
      let retryCount = 0;
      let failureSignature: string | null = null;

      if (t === 4 && r < 0.35) {
        status = "flaky";
        retryCount = 1;
      } else if (t === 3 && i >= runCount - 3 && r < 0.6) {
        status = "failed";
        failureSignature = "TimeoutError: locator.waitFor timed out after 15000ms";
      } else if (r < 0.06) {
        status = "failed";
        failureSignature = "expect(received).toBeVisible() — element not found";
      }

      const jitter = Math.round((r - 0.5) * baseMs * 0.3);
      perRun.push({
        id: fixtureId("22222222", resultCounter++),
        runId,
        testId,
        status,
        durationMs: Math.max(500, baseMs + jitter),
        retryCount,
        failureSignature,
        createdAt: new Date(startedAt.getTime() + baseMs + jitter),
      });
    }

    const anyFailed = perRun.some((p) => p.status === "failed");
    const finishedAt = new Date(
      Math.max(...perRun.map((p) => p.createdAt.getTime())) + 1000
    );

    runs.push({
      id: runId,
      triggerSource: TRIGGERS[i % TRIGGERS.length],
      commitSha: `seed${(1000 + i).toString(16)}`,
      grafanaVersion: GRAFANA_VERSIONS[i % GRAFANA_VERSIONS.length],
      selector: "all",
      status: anyFailed ? "failed" : "passed",
      startedAt,
      finishedAt,
      createdAt,
    });
    testResults.push(...perRun);
  }

  // Health rows derived from the injected flaky/failing tests.
  const testHealth: FixtureTestHealth[] = [
    {
      testId: FIXTURE_TESTS[4].testId,
      flakinessScore: 0.42,
      quarantined: false,
      updatedAt: now,
    },
    {
      testId: FIXTURE_TESTS[3].testId,
      flakinessScore: 0.81,
      quarantined: true,
      updatedAt: now,
    },
  ];

  return { runs, testResults, testHealth };
}
