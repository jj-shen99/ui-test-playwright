import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api } from "../api";
import { useCurrentUser, isAdmin } from "../useCurrentUser";
import {
  CheckCircle,
  XCircle,
  Loader2,
  FileCode2,
  Upload,
  Trash2,
  Scissors,
  Pencil,
  ChevronRight,
  ChevronDown,
  Code2,
  X,
} from "lucide-react";
import HealthBadge from "../components/HealthBadge";

/** One test discovered on disk under app_tests/. */
interface AppTest {
  testId: string;
  file: string;
  title: string;
  caseName: string;
  derivedType: string;
  testType: string;
  overridden: boolean;
}

const TYPE_OPTIONS = ["smoke", "sanity", "regression", "e2e"] as const;

const TYPE_COLORS: Record<string, string> = {
  smoke: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  sanity: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400",
  regression: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
  e2e: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
  unknown: "bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400",
};

/** Inline dropdown to change a test's type; persists via the API. */
function TypeSelect({
  testId,
  value,
  overridden,
}: {
  testId: string;
  value: string;
  overridden?: boolean;
}) {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: (testType: string) => api.setTestType({ testId, testType }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["test-catalog"] });
      queryClient.invalidateQueries({ queryKey: ["app-tests"] });
    },
  });

  const colors = TYPE_COLORS[value] || TYPE_COLORS.unknown;

  return (
    <span className="inline-flex items-center gap-1.5">
      <select
        value={TYPE_OPTIONS.includes(value as (typeof TYPE_OPTIONS)[number]) ? value : ""}
        onChange={(e) => mutation.mutate(e.target.value)}
        disabled={mutation.isPending}
        className={`px-2 py-0.5 rounded text-xs font-medium border-0 cursor-pointer outline-none focus:ring-2 focus:ring-orange-400 disabled:opacity-50 ${colors}`}
        title={overridden ? "Type manually overridden" : "Derived from @tags"}
      >
        {!TYPE_OPTIONS.includes(value as (typeof TYPE_OPTIONS)[number]) && (
          <option value="" disabled>
            {value}
          </option>
        )}
        {TYPE_OPTIONS.map((t) => (
          <option key={t} value={t}>
            {t}
          </option>
        ))}
      </select>
      {mutation.isPending && <Loader2 className="w-3 h-3 animate-spin text-gray-400" />}
      {overridden && !mutation.isPending && (
        <span className="text-[10px] text-orange-500" title="Overridden">
          •
        </span>
      )}
    </span>
  );
}

/** Delete the spec file backing an app test (removes all tests in that file). */
function DeleteAppTestButton({
  file,
  testCount,
}: {
  file: string;
  testCount: number;
}) {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: () => api.deleteAppTest({ file }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["app-tests"] });
    },
  });

  const onClick = () => {
    const msg =
      testCount > 1
        ? `Remove ${file}? This deletes all ${testCount} tests in the file.`
        : `Remove ${file}?`;
    if (window.confirm(msg)) mutation.mutate();
  };

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={mutation.isPending}
      title={`Remove ${file}`}
      className="inline-flex items-center justify-center w-7 h-7 rounded-md text-gray-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-50 transition-colors"
    >
      {mutation.isPending ? (
        <Loader2 className="w-4 h-4 animate-spin" />
      ) : (
        <Trash2 className="w-4 h-4" />
      )}
    </button>
  );
}

/** Rename a single test's title in place (#7). */
function RenameTestButton({ testId, title }: { testId: string; title: string }) {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: (newTitle: string) => api.renameTest({ testId, newTitle }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["app-tests"] });
      queryClient.invalidateQueries({ queryKey: ["test-health"] });
    },
    onError: (err: unknown) =>
      alert(err instanceof Error ? err.message : "Failed to rename test."),
  });

  const onClick = () => {
    const next = window.prompt(`Rename test "${title}" to:`, title);
    if (next === null) return; // cancelled
    const trimmed = next.trim();
    if (!trimmed || trimmed === title) return;
    mutation.mutate(trimmed);
  };

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={mutation.isPending}
      title={`Rename test "${title}"`}
      className="inline-flex items-center justify-center w-7 h-7 rounded-md text-gray-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 disabled:opacity-50 transition-colors"
    >
      {mutation.isPending ? (
        <Loader2 className="w-4 h-4 animate-spin" />
      ) : (
        <Pencil className="w-4 h-4" />
      )}
    </button>
  );
}

/** Delete a single test() from its spec file (removes the file if it's the last one). */
function DeleteSingleTestButton({
  testId,
  title,
  isLastInFile,
  file,
}: {
  testId: string;
  title: string;
  isLastInFile: boolean;
  file: string;
}) {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: () => api.deleteSingleTest({ testId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["app-tests"] });
    },
    onError: (err: unknown) =>
      alert(err instanceof Error ? err.message : "Failed to delete test."),
  });

  const onClick = () => {
    const msg = isLastInFile
      ? `Remove test "${title}"? It is the last test in ${file}, so the file will be deleted.`
      : `Remove test "${title}" from ${file}?`;
    if (window.confirm(msg)) mutation.mutate();
  };

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={mutation.isPending}
      title={`Remove test "${title}"`}
      className="inline-flex items-center justify-center w-7 h-7 rounded-md text-gray-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-50 transition-colors"
    >
      {mutation.isPending ? (
        <Loader2 className="w-4 h-4 animate-spin" />
      ) : (
        <Scissors className="w-4 h-4" />
      )}
    </button>
  );
}

/** Upload a Playwright spec file and register its tests in the catalog. */
function UploadTest() {
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<
    { kind: "success" | "error"; text: string } | null
  >(null);

  const mutation = useMutation({
    mutationFn: (vars: { fileName: string; content: string; testType?: string }) =>
      api.uploadTest(vars),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ["app-tests"] });
      setStatus({
        kind: "success",
        text: `${res.replaced ? "Updated" : "Added"} ${res.file} — ${res.testCount} test${
          res.testCount === 1 ? "" : "s"
        }`,
      });
    },
    onError: (err) => setStatus({ kind: "error", text: (err as Error).message }),
  });

  function onFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    // Reset the input so selecting the same file again re-triggers change.
    e.target.value = "";
    if (!file) return;
    setStatus(null);
    const reader = new FileReader();
    reader.onload = () => {
      const content = String(reader.result ?? "");
      mutation.mutate({
        fileName: file.name,
        content,
      });
    };
    reader.onerror = () => setStatus({ kind: "error", text: "Could not read file" });
    reader.readAsText(file);
  }

  return (
    <div className="flex items-center gap-2">
      {status && (
        <span
          className={`text-xs ${
            status.kind === "success" ? "text-green-600" : "text-red-600"
          }`}
        >
          {status.text}
        </span>
      )}
      <input
        ref={fileInputRef}
        type="file"
        accept=".ts,.spec.ts,text/plain"
        onChange={onFileSelected}
        className="hidden"
      />
      <button
        type="button"
        onClick={() => fileInputRef.current?.click()}
        disabled={mutation.isPending}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-orange-500 hover:bg-orange-600 disabled:bg-orange-300 text-white rounded-md transition-colors"
      >
        {mutation.isPending ? (
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
        ) : (
          <Upload className="w-3.5 h-3.5" />
        )}
        Upload Test
      </button>
    </div>
  );
}

/** Render source with line numbers; highlight lines matching a test title. */
function CodeBlock({
  content,
  highlightTitle,
}: {
  content: string;
  highlightTitle?: string;
}) {
  const lines = content.split("\n");
  return (
    <pre className="text-xs font-mono leading-5 py-3 m-0">
      {lines.map((line, i) => {
        const hit = highlightTitle && line.includes(highlightTitle);
        return (
          <div
            key={i}
            className={
              hit
                ? "bg-yellow-100 dark:bg-yellow-900/40"
                : "hover:bg-gray-50 dark:hover:bg-gray-700/40"
            }
          >
            <span className="inline-block w-10 text-right pr-3 text-gray-400 dark:text-gray-500 select-none">
              {i + 1}
            </span>
            <span className="text-gray-800 dark:text-gray-200 whitespace-pre">
              {line || " "}
            </span>
          </div>
        );
      })}
    </pre>
  );
}

/** Modal that fetches and displays a spec file's script. */
function ScriptModal({
  file,
  caseName,
  highlightTitle,
  onClose,
}: {
  file: string;
  caseName?: string;
  highlightTitle?: string;
  onClose: () => void;
}) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["test-source", file],
    queryFn: () => api.getTestSource(file),
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-4xl w-full max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700">
          <div className="min-w-0 flex items-center gap-2">
            <Code2 className="w-4 h-4 text-gray-500 shrink-0" />
            <div className="min-w-0">
              <div className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate">
                {caseName || "Test script"}
              </div>
              <code className="text-xs font-mono text-gray-500 dark:text-gray-400 truncate block">
                {file}
              </code>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="ml-3 inline-flex items-center justify-center w-7 h-7 rounded-md text-gray-400 hover:text-gray-700 hover:bg-gray-100 dark:hover:bg-gray-700"
            title="Close (Esc)"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="overflow-auto flex-1 bg-gray-50 dark:bg-gray-900/40">
          {isLoading && (
            <div className="p-8 text-center text-gray-400">
              <Loader2 className="w-5 h-5 animate-spin inline mr-2" />
              Loading script...
            </div>
          )}
          {error && (
            <div className="p-6 text-sm text-red-600">
              Failed to load script: {(error as Error).message}
            </div>
          )}
          {data && <CodeBlock content={data.content} highlightTitle={highlightTitle} />}
        </div>
      </div>
    </div>
  );
}

/** Small "view script" icon button. */
function ViewScriptButton({
  onClick,
  label,
}: {
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className="inline-flex items-center justify-center w-7 h-7 rounded-md text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 transition-colors"
    >
      <Code2 className="w-4 h-4" />
    </button>
  );
}

export default function TestCatalog() {
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const userIsAdmin = isAdmin(useCurrentUser());

  const { data, isLoading } = useQuery({
    queryKey: ["test-catalog"],
    queryFn: () => api.getTestCatalog(),
  });

  const { data: appData, isLoading: appLoading } = useQuery({
    queryKey: ["app-tests"],
    queryFn: () => api.getAppTests(),
  });

  const { data: healthData } = useQuery({
    queryKey: ["test-health"],
    queryFn: () => api.getTestHealth(),
  });
  const health = healthData?.health ?? {};

  const allTests = data?.tests ?? [];
  const allAppTests = appData?.tests ?? [];

  const matchesType = (t: { testType: string }) =>
    typeFilter === "all" || t.testType === typeFilter;

  const tests = allTests.filter(matchesType);
  const appTests = allAppTests.filter(matchesType);

  // How many tests live in each file (deleting removes the whole file).
  const fileTestCounts = allAppTests.reduce((acc, t) => {
    acc.set(t.file, (acc.get(t.file) ?? 0) + 1);
    return acc;
  }, new Map<string, number>());

  // Group app tests into a hierarchy: one "test case" per spec file, containing
  // its individual tests. Each top-level test case maps to a single file (#tests
  // UI hierarchy request).
  const appCaseGroups = useMemo(() => {
    const map = new Map<string, { file: string; caseName: string; tests: AppTest[] }>();
    for (const t of appTests) {
      let g = map.get(t.file);
      if (!g) {
        g = { file: t.file, caseName: t.caseName || t.file, tests: [] };
        map.set(t.file, g);
      }
      g.tests.push(t);
    }
    return Array.from(map.values()).sort((a, b) => a.caseName.localeCompare(b.caseName));
  }, [appTests]);

  // Collapsed test-case files (default: all expanded, so the hierarchy is visible).
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const toggleCase = (file: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(file)) next.delete(file);
      else next.add(file);
      return next;
    });

  // The spec file whose script is being viewed in the modal (null = closed).
  const [scriptTarget, setScriptTarget] = useState<
    { file: string; caseName: string; highlightTitle?: string } | null
  >(null);

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Test Catalog</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          App tests are grouped by test case (one per spec file). Expand a case to
          see its tests, and click a test to view its script.
        </p>
        <div className="mt-3 flex items-center gap-2">
          <label
            htmlFor="type-filter"
            className="text-sm font-medium text-gray-600 dark:text-gray-300"
          >
            Filter by type
          </label>
          <select
            id="type-filter"
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 rounded-md px-2 py-1.5 outline-none focus:ring-2 focus:ring-orange-400"
          >
            <option value="all">All types</option>
            {TYPE_OPTIONS.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* App Tests (discovered on disk under app_tests/) — grouped into test
          cases (one per spec file), each expandable to its individual tests. */}
      <section>
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <FileCode2 className="w-4 h-4 text-gray-500 dark:text-gray-400" />
            <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300">
              App Tests
            </h2>
            <span className="text-xs text-gray-400">
              {appCaseGroups.length} test case{appCaseGroups.length === 1 ? "" : "s"},{" "}
              {appTests.length} test{appTests.length === 1 ? "" : "s"} under{" "}
              <code className="font-mono">app_tests/</code>
            </span>
          </div>
          <UploadTest />
        </div>

        {appLoading && (
          <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 shadow-sm text-center py-12 text-gray-400">
            <Loader2 className="w-5 h-5 animate-spin inline mr-2" />
            Discovering tests...
          </div>
        )}

        {!appLoading && appCaseGroups.length === 0 && (
          <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 shadow-sm text-center py-12 text-gray-400">
            No tests found under <code className="font-mono">app_tests/</code>.
          </div>
        )}

        <div className="space-y-3">
          {appCaseGroups.map((group) => {
            const isExpanded = !collapsed.has(group.file);
            const total = fileTestCounts.get(group.file) ?? group.tests.length;
            return (
              <div
                key={group.file}
                className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden"
              >
                {/* Test-case header (top level) */}
                <div className="flex items-center gap-2 px-3 py-2.5 bg-gray-50 dark:bg-gray-800/60 border-b border-gray-200 dark:border-gray-700">
                  <button
                    type="button"
                    onClick={() => toggleCase(group.file)}
                    className="inline-flex items-center justify-center w-6 h-6 rounded text-gray-500 hover:bg-gray-200 dark:hover:bg-gray-700"
                    title={isExpanded ? "Collapse" : "Expand"}
                    aria-expanded={isExpanded}
                  >
                    {isExpanded ? (
                      <ChevronDown className="w-4 h-4" />
                    ) : (
                      <ChevronRight className="w-4 h-4" />
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => toggleCase(group.file)}
                    className="flex-1 min-w-0 text-left"
                  >
                    <div className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate">
                      {group.caseName}
                    </div>
                    <code className="text-xs font-mono text-gray-500 dark:text-gray-400 truncate block">
                      {group.file}
                    </code>
                  </button>
                  <span className="text-xs text-gray-400 shrink-0">
                    {group.tests.length}
                    {group.tests.length !== total ? ` / ${total}` : ""} test
                    {total === 1 ? "" : "s"}
                  </span>
                  <ViewScriptButton
                    label={`View script for ${group.caseName}`}
                    onClick={() =>
                      setScriptTarget({ file: group.file, caseName: group.caseName })
                    }
                  />
                  {userIsAdmin && (
                    <DeleteAppTestButton file={group.file} testCount={total} />
                  )}
                </div>

                {/* Individual tests (children of the test case) */}
                {isExpanded && (
                  <ul className="divide-y divide-gray-100 dark:divide-gray-700">
                    {group.tests.map((t) => (
                      <li
                        key={t.testId}
                        className="flex items-center gap-2 pl-11 pr-3 py-2.5 hover:bg-gray-50 dark:hover:bg-gray-700/50"
                      >
                        <button
                          type="button"
                          onClick={() =>
                            setScriptTarget({
                              file: t.file,
                              caseName: group.caseName,
                              highlightTitle: t.title,
                            })
                          }
                          className="flex-1 min-w-0 text-left text-gray-800 dark:text-gray-200 hover:text-indigo-600 dark:hover:text-indigo-400"
                          title="View script"
                        >
                          <span className="inline-flex items-center gap-2">
                            <span className="truncate">{t.title}</span>
                            <HealthBadge health={health[t.testId]} />
                          </span>
                        </button>
                        <TypeSelect
                          testId={t.testId}
                          value={t.testType}
                          overridden={t.overridden}
                        />
                        <ViewScriptButton
                          label={`View script for "${t.title}"`}
                          onClick={() =>
                            setScriptTarget({
                              file: t.file,
                              caseName: group.caseName,
                              highlightTitle: t.title,
                            })
                          }
                        />
                        {userIsAdmin && (
                          <span className="inline-flex items-center gap-1">
                            <RenameTestButton testId={t.testId} title={t.title} />
                            <DeleteSingleTestButton
                              testId={t.testId}
                              title={t.title}
                              file={t.file}
                              isLastInFile={(fileTestCounts.get(t.file) ?? 1) <= 1}
                            />
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* History (from run results) */}
      <section>
        <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300">
          History
        </h2>
        <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">
          Tests that have actually executed, aggregated from run history (run
          count, average duration, last status). Click a Test ID to see its full
          history.
        </p>
        <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-800/50 border-b border-gray-200 dark:border-gray-700">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-gray-600 dark:text-gray-400">
                  Test ID
                </th>
                <th className="text-left px-4 py-3 font-medium text-gray-600 dark:text-gray-400">
                  Type
                </th>
                <th className="text-left px-4 py-3 font-medium text-gray-600 dark:text-gray-400">
                  Last Status
                </th>
                <th className="text-left px-4 py-3 font-medium text-gray-600 dark:text-gray-400">
                  Runs
                </th>
                <th className="text-left px-4 py-3 font-medium text-gray-600 dark:text-gray-400">
                  Avg Duration
                </th>
                <th className="text-left px-4 py-3 font-medium text-gray-600 dark:text-gray-400">
                  Last Run
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
              {isLoading && (
                <tr>
                  <td colSpan={6} className="text-center py-12 text-gray-400">
                    <Loader2 className="w-5 h-5 animate-spin inline mr-2" />
                    Loading...
                  </td>
                </tr>
              )}
              {tests.map((t) => (
                <tr key={t.testId} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center gap-2">
                      <Link
                        to={`/tests/${encodeURIComponent(t.testId)}`}
                        className="text-blue-600 hover:underline text-xs font-mono"
                      >
                        {t.testId}
                      </Link>
                      <HealthBadge health={health[t.testId]} />
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <TypeSelect testId={t.testId} value={t.testType} overridden={t.overridden} />
                  </td>
                  <td className="px-4 py-3">
                    <span className="flex items-center gap-1.5">
                      {t.lastStatus === "passed" ? (
                        <CheckCircle className="w-3.5 h-3.5 text-green-500" />
                      ) : (
                        <XCircle className="w-3.5 h-3.5 text-red-500" />
                      )}
                      <span className="text-xs">{t.lastStatus}</span>
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-600 dark:text-gray-300">{t.runCount}</td>
                  <td className="px-4 py-3 text-gray-600 dark:text-gray-300">
                    {t.avgDurationMs
                      ? `${(t.avgDurationMs / 1000).toFixed(1)}s`
                      : "—"}
                  </td>
                  <td className="px-4 py-3 text-gray-500 dark:text-gray-400 text-xs">
                    {t.lastRun ? new Date(t.lastRun).toLocaleString() : "—"}
                  </td>
                </tr>
              ))}
              {!isLoading && tests.length === 0 && (
                <tr>
                  <td colSpan={6} className="text-center py-12 text-gray-400">
                    No tests recorded yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {scriptTarget && (
        <ScriptModal
          file={scriptTarget.file}
          caseName={scriptTarget.caseName}
          highlightTitle={scriptTarget.highlightTitle}
          onClose={() => setScriptTarget(null)}
        />
      )}
    </div>
  );
}
