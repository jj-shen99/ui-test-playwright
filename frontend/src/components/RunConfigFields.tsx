/**
 * Shared run-configuration UI used by both the Trigger Run page and the
 * Schedules "New Schedule" form so the two stay consistent.
 *
 * - RunTargetConfig: the target application URL + authentication fields.
 * - useIndividualTests(): loads the combined catalog + app_tests test list.
 * - TestSelectorField: preset-suite / individual-tests selector.
 * - TargetAuthFields: remote URL + auth (none / basic / token).
 */

import { useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Search, Globe, Lock, PlugZap, CheckCircle2, XCircle, AlertTriangle, Loader2, ChevronRight, ChevronDown } from "lucide-react";
import { api } from "../api";
import { describeTargetUrl } from "../targetUrl";

export type RunMode = "preset" | "individual";
export type AuthType = "none" | "basic" | "token";

export interface RunTargetConfig {
  mode: RunMode;
  selector: string;
  selectedTestIds: string[];
  targetUrl: string;
  authType: AuthType;
  authUsername: string;
  authPassword: string;
  authToken: string;
}

export const defaultRunTargetConfig: RunTargetConfig = {
  mode: "preset",
  selector: "all",
  selectedTestIds: [],
  targetUrl: "",
  authType: "none",
  authUsername: "",
  authPassword: "",
  authToken: "",
};

const inputClass =
  "w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 rounded-md px-3 py-2 text-sm focus:ring-2 focus:ring-orange-400 focus:border-orange-400 outline-none";

/** A single individually-runnable test, with its owning test case (spec file). */
export interface IndividualTest {
  testId: string;
  label: string;
  type: string;
  /** Spec file the test lives in ("" for legacy catalog-only tests). */
  file: string;
  /** Human-friendly test-case name used to group tests in the selector. */
  caseName: string;
}

/** Grouping bucket for catalog-only tests that have no owning spec file. */
const OTHER_CASE = "Other tests";

/** Combined, de-duplicated list of individually-runnable tests. */
export function useIndividualTests(): IndividualTest[] {
  const { data: catalogData } = useQuery({
    queryKey: ["testCatalog"],
    queryFn: api.getTestCatalog,
  });
  const { data: appData } = useQuery({
    queryKey: ["appTests"],
    queryFn: api.getAppTests,
  });

  return useMemo(() => {
    const map = new Map<string, IndividualTest>();
    for (const t of appData?.tests ?? []) {
      map.set(t.testId, {
        testId: t.testId,
        label: t.title,
        type: t.testType,
        file: t.file,
        caseName: t.caseName || t.file,
      });
    }
    for (const t of catalogData?.tests ?? []) {
      if (!map.has(t.testId)) {
        map.set(t.testId, {
          testId: t.testId,
          label: t.testId,
          type: t.testType,
          file: "",
          caseName: OTHER_CASE,
        });
      }
    }
    return Array.from(map.values());
  }, [appData, catalogData]);
}

/** Translate a config into the API payload fields shared by /runs and /schedules. */
export function runConfigToPayload(config: RunTargetConfig) {
  return {
    selector: config.mode === "preset" ? config.selector : "all",
    testIds: config.mode === "individual" ? config.selectedTestIds : undefined,
    targetUrl: config.targetUrl.trim() || undefined,
    authType: config.authType,
    authUsername: config.authUsername.trim() || undefined,
    authPassword: config.authPassword || undefined,
    authToken: config.authToken.trim() || undefined,
  };
}

interface FieldProps {
  config: RunTargetConfig;
  onChange: (patch: Partial<RunTargetConfig>) => void;
  search: string;
  onSearchChange: (s: string) => void;
}

const tabClass = (active: boolean) =>
  `flex-1 px-3 py-2 text-sm font-medium rounded-md transition-colors ${
    active
      ? "bg-orange-500 text-white"
      : "bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600"
  }`;

export function TestSelectorField({ config, onChange, search, onSearchChange }: FieldProps) {
  const allTests = useIndividualTests();

  const filteredTests = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return allTests;
    return allTests.filter(
      (t) => t.label.toLowerCase().includes(q) || t.testId.toLowerCase().includes(q)
    );
  }, [allTests, search]);

  const selected = new Set(config.selectedTestIds);

  // Group filtered tests into a hierarchy: one test case per spec file,
  // containing its individual tests — mirroring the /tests catalog structure.
  const caseGroups = useMemo(() => {
    const map = new Map<
      string,
      { key: string; caseName: string; tests: IndividualTest[] }
    >();
    for (const t of filteredTests) {
      const key = t.file || t.caseName;
      let g = map.get(key);
      if (!g) {
        g = { key, caseName: t.caseName || t.file || key, tests: [] };
        map.set(key, g);
      }
      g.tests.push(t);
    }
    return Array.from(map.values()).sort((a, b) =>
      a.caseName.localeCompare(b.caseName)
    );
  }, [filteredTests]);

  // Collapsed test-case groups (default: all expanded so the hierarchy shows).
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const toggleCase = (key: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  // When searching, always reveal matches regardless of collapsed state.
  const searching = search.trim() !== "";

  function toggleTest(testId: string) {
    const next = new Set(selected);
    if (next.has(testId)) next.delete(testId);
    else next.add(testId);
    onChange({ selectedTestIds: Array.from(next) });
  }

  function toggleCaseTests(tests: IndividualTest[], selectAll: boolean) {
    const next = new Set(selected);
    for (const t of tests) {
      if (selectAll) next.add(t.testId);
      else next.delete(t.testId);
    }
    onChange({ selectedTestIds: Array.from(next) });
  }

  return (
    <div className="space-y-4">
      {/* Mode toggle */}
      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
          What to run
        </label>
        <div className="flex gap-2">
          <button type="button" onClick={() => onChange({ mode: "preset" })} className={tabClass(config.mode === "preset")}>
            Preset Suite
          </button>
          <button type="button" onClick={() => onChange({ mode: "individual" })} className={tabClass(config.mode === "individual")}>
            Individual Tests
          </button>
        </div>
      </div>

      {config.mode === "preset" && (
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            Test Selector
          </label>
          <select value={config.selector} onChange={(e) => onChange({ selector: e.target.value })} className={inputClass}>
            <option value="all">All Tests</option>
            <option disabled>── By Test Type ──</option>
            <option value="smoke">Smoke — quick high-level checks</option>
            <option value="sanity">Sanity — focused feature verification</option>
            <option value="regression">Regression — full coverage</option>
            <option value="e2e">E2E — end-to-end user journeys</option>
          </select>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            Run the full suite or a subset by test type.
          </p>
        </div>
      )}

      {config.mode === "individual" && (
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
              Select Tests
            </label>
            <span className="text-xs text-gray-500 dark:text-gray-400">
              {config.selectedTestIds.length} selected
            </span>
          </div>
          <div className="relative mb-2">
            <Search className="w-4 h-4 text-gray-400 absolute left-2.5 top-2.5" />
            <input
              type="text"
              value={search}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder="Search tests..."
              className={`${inputClass} pl-8`}
            />
          </div>
          <div className="border border-gray-200 dark:border-gray-700 rounded-md max-h-64 overflow-auto divide-y divide-gray-100 dark:divide-gray-700">
            {caseGroups.length === 0 && (
              <p className="text-xs text-gray-400 text-center py-6">No tests found.</p>
            )}
            {caseGroups.map((group) => {
              const selectedCount = group.tests.filter((t) =>
                selected.has(t.testId)
              ).length;
              const allSelected = selectedCount === group.tests.length;
              const someSelected = selectedCount > 0 && !allSelected;
              const isCollapsed = collapsed.has(group.key) && !searching;
              return (
                <div key={group.key}>
                  {/* Test case (spec file) header */}
                  <div className="flex items-center gap-2 px-2 py-2 bg-gray-50 dark:bg-gray-800/60 sticky top-0">
                    <button
                      type="button"
                      onClick={() => toggleCase(group.key)}
                      className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
                      aria-label={isCollapsed ? "Expand test case" : "Collapse test case"}
                    >
                      {isCollapsed ? (
                        <ChevronRight className="w-4 h-4" />
                      ) : (
                        <ChevronDown className="w-4 h-4" />
                      )}
                    </button>
                    <input
                      type="checkbox"
                      checked={allSelected}
                      ref={(el) => {
                        if (el) el.indeterminate = someSelected;
                      }}
                      onChange={() => toggleCaseTests(group.tests, !allSelected)}
                      className="accent-orange-500"
                      title="Select all tests in this case"
                    />
                    <button
                      type="button"
                      onClick={() => toggleCase(group.key)}
                      className="min-w-0 flex-1 text-left"
                    >
                      <span className="block text-sm font-medium text-gray-800 dark:text-gray-100 truncate">
                        {group.caseName}
                      </span>
                      {group.key !== group.caseName && (
                        <span className="block text-[11px] font-mono text-gray-400 truncate">
                          {group.key}
                        </span>
                      )}
                    </button>
                    <span className="text-[11px] text-gray-400 shrink-0 pr-1">
                      {selectedCount}/{group.tests.length}
                    </span>
                  </div>

                  {/* Individual tests within the case */}
                  {!isCollapsed &&
                    group.tests.map((t) => (
                      <label
                        key={t.testId}
                        className="flex items-start gap-2 pl-9 pr-3 py-2 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/50"
                      >
                        <input
                          type="checkbox"
                          checked={selected.has(t.testId)}
                          onChange={() => toggleTest(t.testId)}
                          className="mt-0.5 accent-orange-500"
                        />
                        <span className="min-w-0">
                          <span className="block text-sm text-gray-800 dark:text-gray-200 truncate">
                            {t.label}
                          </span>
                          <span className="block text-[11px] font-mono text-gray-400 truncate">
                            {t.testId}
                          </span>
                        </span>
                      </label>
                    ))}
                </div>
              );
            })}
          </div>
          {config.selectedTestIds.length > 0 && (
            <button
              type="button"
              onClick={() => onChange({ selectedTestIds: [] })}
              className="text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 mt-1.5"
            >
              Clear selection
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export function TargetAuthFields({
  config,
  onChange,
  persisted = false,
}: {
  config: RunTargetConfig;
  onChange: (patch: Partial<RunTargetConfig>) => void;
  persisted?: boolean;
}) {
  const urlInfo = describeTargetUrl(config.targetUrl);
  const preflight = useMutation({
    mutationFn: () =>
      api.preflightTarget({
        targetUrl: config.targetUrl.trim(),
        authType: config.authType,
        authUsername: config.authUsername.trim() || undefined,
        authPassword: config.authPassword || undefined,
        authToken: config.authToken.trim() || undefined,
      }),
  });
  const result = preflight.data;
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-1.5">
        <Globe className="w-4 h-4 text-gray-500 dark:text-gray-400" />
        <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
          Target Application
        </span>
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
          Application URL
        </label>
        <input
          type="url"
          value={config.targetUrl}
          onChange={(e) => onChange({ targetUrl: e.target.value })}
          placeholder="https://my-grafana.example.com (leave blank for local env)"
          className={inputClass}
        />
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
          Run tests against a remote deployment. Blank uses the local docker environment.
        </p>

        {config.targetUrl.trim() !== "" && !urlInfo.valid && (
          <p className="text-xs text-amber-600 dark:text-amber-400 mt-1.5">
            Enter a full URL including <code className="font-mono">https://</code>.
          </p>
        )}

        {urlInfo.valid && (
          <div className="mt-2 rounded-md border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 px-3 py-2 space-y-1">
            <p className="text-xs text-gray-600 dark:text-gray-300">
              <span className="text-gray-400">Auth / login uses origin:</span>{" "}
              <code className="font-mono text-gray-800 dark:text-gray-200">{urlInfo.origin}</code>
            </p>
            {urlInfo.isDeepLink && (
              <>
                <p className="text-xs text-gray-600 dark:text-gray-300">
                  <span className="text-gray-400">Navigates to path:</span>{" "}
                  <code className="font-mono text-gray-800 dark:text-gray-200 break-all">
                    {urlInfo.path}
                  </code>
                </p>
                <p className="text-[11px] text-gray-400">
                  Deep link detected — the origin is used for login, the path/query for navigation.
                </p>
              </>
            )}
          </div>
        )}
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
          Authentication
        </label>
        <select
          value={config.authType}
          onChange={(e) => onChange({ authType: e.target.value as AuthType })}
          className={inputClass}
        >
          <option value="none">None</option>
          <option value="basic">Username &amp; Password</option>
          <option value="token">API Token</option>
        </select>
      </div>

      {config.authType === "basic" && (
        <div className="space-y-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Username
            </label>
            <input
              type="text"
              value={config.authUsername}
              onChange={(e) => onChange({ authUsername: e.target.value })}
              autoComplete="off"
              className={inputClass}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Password
            </label>
            <input
              type="password"
              value={config.authPassword}
              onChange={(e) => onChange({ authPassword: e.target.value })}
              autoComplete="new-password"
              className={inputClass}
            />
          </div>
        </div>
      )}

      {config.authType === "token" && (
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            API Token
          </label>
          <input
            type="password"
            value={config.authToken}
            onChange={(e) => onChange({ authToken: e.target.value })}
            autoComplete="off"
            className={inputClass}
          />
        </div>
      )}

      {config.authType !== "none" && (
        <p className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
          <Lock className="w-3 h-3" />
          {persisted
            ? "Scheduled runs store these credentials so they can authenticate unattended."
            : "Credentials are used only for this run and are not stored in the database."}
        </p>
      )}

      {/* Pre-flight connection check */}
      <div className="pt-1">
        <button
          type="button"
          onClick={() => preflight.mutate()}
          disabled={!urlInfo.valid || preflight.isPending}
          title={
            urlInfo.valid
              ? "Check the target is reachable and credentials authenticate"
              : "Enter a valid target URL first"
          }
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 rounded-md hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {preflight.isPending ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <PlugZap className="w-3.5 h-3.5" />
          )}
          Test connection
        </button>

        {preflight.isError && (
          <p className="flex items-center gap-1.5 text-xs text-red-600 dark:text-red-400 mt-2">
            <XCircle className="w-3.5 h-3.5 shrink-0" />
            {(preflight.error as Error).message}
          </p>
        )}

        {result && (
          <p
            className={`flex items-center gap-1.5 text-xs mt-2 ${
              result.authenticated === true
                ? "text-green-600 dark:text-green-400"
                : result.authenticated === false || !result.reachable
                  ? "text-red-600 dark:text-red-400"
                  : "text-amber-600 dark:text-amber-400"
            }`}
          >
            {result.authenticated === true ? (
              <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
            ) : result.authenticated === false || !result.reachable ? (
              <XCircle className="w-3.5 h-3.5 shrink-0" />
            ) : (
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
            )}
            {result.message}
          </p>
        )}
      </div>
    </div>
  );
}
