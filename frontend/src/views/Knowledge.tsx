import {
  BookOpen,
  Layers,
  Activity,
  ShieldAlert,
  Bug,
  Paperclip,
  Target,
  CheckSquare,
} from "lucide-react";
import { QUARANTINE_THRESHOLD, WATCH_THRESHOLD } from "../testHealth";

/**
 * Knowledge — a static, self-contained reference that explains the terminology
 * and criteria used across the framework (test sources, types, statuses,
 * flakiness/quarantine, failure analysis, artifacts, and authoring rules).
 *
 * Values here are kept in sync with the code they describe (e.g. the flakiness
 * thresholds are imported from testHealth.ts rather than hard-coded).
 */

interface Row {
  term: string;
  desc: string;
  meta?: string;
}

const quarantinePct = Math.round(QUARANTINE_THRESHOLD * 100);
const watchPct = Math.round(WATCH_THRESHOLD * 100);

const SOURCES: Row[] = [
  {
    term: "App Tests",
    meta: "on disk · app_tests/",
    desc: "The real, hand-written Playwright specs discovered on disk under app_tests/. This is the source of truth for what CAN run. They are grouped on the Test Catalog by test case (one per spec file) and are what the orchestrator executes.",
  },
  {
    term: "Generated Tests",
    meta: "tests/generated/",
    desc: "Specs produced by the Generate page from a Grafana dashboard (UID or JSON), optionally LLM-assisted. They are written to tests/generated/ and then behave like any other spec.",
  },
  {
    term: "History",
    meta: "from the results DB",
    desc: "An aggregate view of every test that has actually executed, built from the test_results table (grouped by test id). Shown as the 'History' section on the Test Catalog, it lists run count, average duration, last status, last run, and links to each test's full history. Unlike App Tests (disk), this only lists tests that have run history.",
  },
];

const TYPES: Row[] = [
  {
    term: "Smoke",
    meta: "@smoke · every PR",
    desc: "Fastest, broadest, shallowest checks — 'does it load / render without an error state'. Tagged @smoke and run on every pull request. Generated smoke specs assert panels render without error.",
  },
  {
    term: "Sanity",
    meta: "focused",
    desc: "Narrow correctness checks on key functionality after a change — a step deeper than smoke, but not exhaustive.",
  },
  {
    term: "Regression",
    meta: "broad + deep",
    desc: "Comprehensive assertions across features intended to catch regressions. The widest and deepest coverage; typically run nightly / on the full suite.",
  },
  {
    term: "E2E",
    meta: "user journeys",
    desc: "End-to-end user journeys that cross multiple views and interactions (navigation, drill-downs, variable changes) rather than a single panel.",
  },
];

const RUN_STATUSES: Row[] = [
  { term: "queued", desc: "Run created and waiting for an orchestrator worker." },
  { term: "running", desc: "The orchestrator is actively executing Playwright." },
  { term: "passed", desc: "The run finished and every executed test passed." },
  { term: "failed", desc: "The run finished but one or more tests failed." },
  { term: "error", desc: "The run could not complete (setup/clone/infra failure)." },
];

const RESULT_STATUSES: Row[] = [
  { term: "passed", desc: "The test passed on its first attempt." },
  { term: "failed", desc: "The test failed after exhausting its retries." },
  { term: "skipped", desc: "The test was not executed (e.g. skipped or quarantined)." },
  {
    term: "flaky",
    desc: "The test failed at least once but PASSED on a retry within the same run — the classic flaky signal.",
  },
];

const TRIGGERS: Row[] = [
  { term: "manual", desc: "Started by a user from the Trigger Run page." },
  { term: "pr", desc: "Started automatically when a pull request opens (smoke scope)." },
  { term: "nightly", desc: "Started on a cron schedule (typically the full suite)." },
];

const SELECTORS: Row[] = [
  { term: "all", desc: "Run the entire suite." },
  { term: "smoke", desc: "Run only @smoke-tagged tests." },
  { term: "tag", desc: "Run tests carrying a given @tag." },
  { term: "file", desc: "Run a single spec file." },
  { term: "individual", desc: "Run one or more explicitly-picked tests from the catalog (these run even if quarantined)." },
];

const HEALTH_BADGES: Row[] = [
  {
    term: "healthy",
    meta: `< ${watchPct}% flaky`,
    desc: "Below the watch threshold — no badge is shown.",
  },
  {
    term: "watch",
    meta: `≥ ${watchPct}% flaky`,
    desc: "Mildly flaky; surfaced as a yellow badge so it stays visible before it becomes a problem.",
  },
  {
    term: "flaky",
    meta: `≥ ${quarantinePct}% flaky`,
    desc: "Flaky enough to matter; shown prominently.",
  },
  {
    term: "quarantined",
    meta: `≥ ${quarantinePct}% (auto)`,
    desc: "Automatically quarantined by the ML pipeline. Still tracked and reported, but skipped during normal runs so its noise doesn't block CI.",
  },
];

const FAILURE_TERMS: Row[] = [
  {
    term: "Failure signature",
    desc: "The normalized error message stored for a failed result. Used to group and match similar failures.",
  },
  {
    term: "Failure cluster",
    desc: "A group of failures that share the same signature. Helps tell a systemic issue apart from an isolated one.",
  },
  {
    term: "Triage suggestion",
    desc: "For a given failure, the nearest historical failures by signature — a starting point for investigation.",
  },
];

const ARTIFACTS: Row[] = [
  { term: "trace", desc: "Playwright trace (timeline, DOM snapshots, network) for a failed test." },
  { term: "video", desc: "Recording of the browser during the test." },
  { term: "screenshot", desc: "Image captured at the point of failure." },
  { term: "log", desc: "Captured console / stdout output." },
];

const AUTHORING_RULES: Row[] = [
  {
    term: "Await web-first assertions",
    desc: "Use await expect(locator).toBeVisible() etc. — never a bare expect on a locator. The review gate and ESLint block missing awaits.",
  },
  {
    term: "No arbitrary waits",
    desc: "No waitForTimeout(...) sleeps and no waitUntil: 'networkidle'; rely on web-first, auto-retrying assertions instead.",
  },
  {
    term: "Locator ladder",
    desc: "Prefer getByRole / getByLabel / getByTestId over raw CSS or XPath, and avoid .nth() enumeration. Grafana data-testid attributes are treated as a stable API.",
  },
  {
    term: "No debug leftovers",
    desc: "No test.only, no page.pause(), and no unjustified force: true committed to the suite.",
  },
];

function Section({
  icon: Icon,
  title,
  intro,
  rows,
  color,
}: {
  icon: typeof BookOpen;
  title: string;
  intro?: string;
  rows: Row[];
  color: string;
}) {
  return (
    <section
      id={title.toLowerCase().replace(/\s+/g, "-")}
      className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-5 shadow-sm scroll-mt-6"
    >
      <div className="flex items-center gap-2 mb-3">
        <Icon className={`w-5 h-5 ${color}`} />
        <h2 className="font-semibold text-gray-900 dark:text-gray-100">{title}</h2>
      </div>
      {intro && (
        <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">{intro}</p>
      )}
      <dl className="divide-y divide-gray-100 dark:divide-gray-700">
        {rows.map((r) => (
          <div
            key={r.term}
            className="py-2.5 grid grid-cols-1 sm:grid-cols-[9rem_1fr] gap-1 sm:gap-4"
          >
            <dt className="text-sm font-medium text-gray-900 dark:text-gray-100">
              {r.term}
              {r.meta && (
                <span className="block text-[11px] font-normal text-gray-400 font-mono mt-0.5">
                  {r.meta}
                </span>
              )}
            </dt>
            <dd className="text-sm text-gray-600 dark:text-gray-300">{r.desc}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

const TOC = [
  { id: "test-sources", label: "Test Sources" },
  { id: "test-types-&-criteria", label: "Test Types" },
  { id: "run-statuses", label: "Run Statuses" },
  { id: "result-statuses", label: "Result Statuses" },
  { id: "triggers-&-selectors", label: "Triggers & Selectors" },
  { id: "flakiness-&-quarantine", label: "Flakiness & Quarantine" },
  { id: "failure-analysis", label: "Failure Analysis" },
  { id: "artifacts", label: "Artifacts" },
  { id: "authoring-criteria", label: "Authoring Rules" },
];

export default function Knowledge() {
  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center gap-2 mb-1">
        <BookOpen className="w-6 h-6 text-orange-500" />
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Knowledge</h1>
      </div>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
        A reference for the terminology and criteria used across the framework —
        what the words mean and how the automated decisions are made.
      </p>

      <nav className="flex flex-wrap gap-2 mb-6">
        {TOC.map((t) => (
          <a
            key={t.id}
            href={`#${t.id}`}
            className="text-xs px-2.5 py-1 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-orange-100 dark:hover:bg-orange-900/30 hover:text-orange-600"
          >
            {t.label}
          </a>
        ))}
      </nav>

      <div className="space-y-5">
        <Section
          icon={Layers}
          color="text-blue-500"
          title="Test Sources"
          intro="Where tests come from, and what the App Tests and History groupings on the Test Catalog (/tests) actually represent."
          rows={SOURCES}
        />
        <Section
          icon={CheckSquare}
          color="text-indigo-500"
          title="Test Types & Criteria"
          intro="Type controls the depth and breadth of a test. A test's type is derived from its id path prefix (smoke/, sanity/, regression/, e2e/) and can be overridden per-test in the catalog."
          rows={TYPES}
        />
        <Section
          icon={Activity}
          color="text-emerald-500"
          title="Run Statuses"
          intro="The lifecycle status of an entire run."
          rows={RUN_STATUSES}
        />
        <Section
          icon={Activity}
          color="text-emerald-600"
          title="Result Statuses"
          intro="The outcome recorded for a single test within a run."
          rows={RESULT_STATUSES}
        />
        <Section
          icon={Target}
          color="text-cyan-500"
          title="Triggers & Selectors"
          intro="How a run starts (trigger source) and which tests it includes (selector)."
          rows={[...TRIGGERS, ...SELECTORS]}
        />
        <Section
          icon={ShieldAlert}
          color="text-orange-500"
          title="Flakiness & Quarantine"
          intro={`A result is 'flaky' when it passed only after a retry. The ML pipeline also computes a per-test flakiness score (0–100%) over a rolling window: the fraction of recent commits where the test either mixed pass/fail or produced a retried-then-passed result. A test is auto-quarantined at ≥ ${quarantinePct}%.`}
          rows={HEALTH_BADGES}
        />
        <Section
          icon={Bug}
          color="text-purple-500"
          title="Failure Analysis"
          rows={FAILURE_TERMS}
        />
        <Section
          icon={Paperclip}
          color="text-pink-500"
          title="Artifacts"
          intro="Files captured for a result (failures always capture artifacts) and viewable from the failure drill-down."
          rows={ARTIFACTS}
        />
        <Section
          icon={CheckSquare}
          color="text-amber-500"
          title="Authoring Criteria"
          intro="Rules enforced on every test (by the LLM draft review gate and ESLint) to keep the suite stable and deterministic."
          rows={AUTHORING_RULES}
        />
      </div>
    </div>
  );
}
