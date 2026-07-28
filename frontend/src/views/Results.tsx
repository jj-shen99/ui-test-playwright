import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api } from "../api";
import {
  CheckCircle,
  XCircle,
  SkipForward,
  AlertTriangle,
  ClipboardList,
  Loader2,
  Search,
  ExternalLink,
} from "lucide-react";

const STATUS_ICON: Record<string, React.ReactNode> = {
  passed: <CheckCircle className="w-4 h-4 text-green-500" />,
  failed: <XCircle className="w-4 h-4 text-red-500" />,
  skipped: <SkipForward className="w-4 h-4 text-gray-400" />,
  flaky: <AlertTriangle className="w-4 h-4 text-yellow-500" />,
};

export default function Results() {
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [search, setSearch] = useState("");

  // Fetch recent runs to let user pick one
  const { data: runsData, isLoading: runsLoading } = useQuery({
    queryKey: ["runs"],
    queryFn: () => api.getRuns(30),
  });

  // Fetch results for the selected run
  const { data: resultsData, isLoading: resultsLoading } = useQuery({
    queryKey: ["results", selectedRunId],
    queryFn: () => api.getRunResults(selectedRunId!),
    enabled: !!selectedRunId,
  });

  const runs = runsData?.runs || [];
  const results = resultsData?.results || [];

  // Filters
  const filteredResults = results.filter((r) => {
    if (statusFilter !== "all" && r.status !== statusFilter) return false;
    if (search && !r.testId.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  // Stats
  const stats = {
    total: results.length,
    passed: results.filter((r) => r.status === "passed").length,
    failed: results.filter((r) => r.status === "failed").length,
    skipped: results.filter((r) => r.status === "skipped").length,
    flaky: results.filter((r) => r.status === "flaky").length,
  };

  return (
    <div className="p-8 max-w-6xl">
      <div className="flex items-center gap-3 mb-6">
        <ClipboardList className="w-6 h-6 text-gray-700 dark:text-gray-300" />
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Test Results</h1>
      </div>

      {/* Run selector */}
      <div className="mb-6 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-4">
        <label className="text-sm font-medium text-gray-600 dark:text-gray-300 mb-2 block">
          Select a run to view results:
        </label>
        <select
          value={selectedRunId || ""}
          onChange={(e) => setSelectedRunId(e.target.value || null)}
          className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 rounded-md text-sm"
        >
          <option value="">— Choose a run —</option>
          {runsLoading && <option disabled>Loading runs...</option>}
          {runs.map((run) => (
            <option key={run.id} value={run.id}>
              {new Date(run.createdAt).toLocaleString()} — {run.selector} — {run.status} — {run.grafanaVersion}
            </option>
          ))}
        </select>
      </div>

      {/* Results area */}
      {selectedRunId && (
        <>
          {/* Stats cards */}
          <div className="grid grid-cols-5 gap-3 mb-6">
            <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-3 text-center">
              <div className="text-2xl font-bold text-gray-900 dark:text-gray-100">{stats.total}</div>
              <div className="text-xs text-gray-500 dark:text-gray-400">Total</div>
            </div>
            <div className="bg-white dark:bg-gray-800 border border-green-200 dark:border-green-800 rounded-lg p-3 text-center">
              <div className="text-2xl font-bold text-green-600">{stats.passed}</div>
              <div className="text-xs text-gray-500 dark:text-gray-400">Passed</div>
            </div>
            <div className="bg-white dark:bg-gray-800 border border-red-200 dark:border-red-800 rounded-lg p-3 text-center">
              <div className="text-2xl font-bold text-red-600">{stats.failed}</div>
              <div className="text-xs text-gray-500 dark:text-gray-400">Failed</div>
            </div>
            <div className="bg-white dark:bg-gray-800 border border-yellow-200 dark:border-yellow-800 rounded-lg p-3 text-center">
              <div className="text-2xl font-bold text-yellow-600">{stats.flaky}</div>
              <div className="text-xs text-gray-500 dark:text-gray-400">Flaky</div>
            </div>
            <div className="bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 rounded-lg p-3 text-center">
              <div className="text-2xl font-bold text-gray-400">{stats.skipped}</div>
              <div className="text-xs text-gray-500 dark:text-gray-400">Skipped</div>
            </div>
          </div>

          {/* Filters */}
          <div className="flex gap-3 mb-4">
            <div className="relative flex-1">
              <Search className="w-4 h-4 absolute left-3 top-2.5 text-gray-400" />
              <input
                type="text"
                placeholder="Search by test name..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full pl-9 pr-3 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 rounded-md text-sm"
              />
            </div>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="px-3 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 rounded-md text-sm"
            >
              <option value="all">All statuses</option>
              <option value="passed">Passed</option>
              <option value="failed">Failed</option>
              <option value="flaky">Flaky</option>
              <option value="skipped">Skipped</option>
            </select>
          </div>

          {/* Results table */}
          {resultsLoading ? (
            <div className="flex items-center gap-2 text-gray-500 py-8">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading results...
            </div>
          ) : (
            <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 dark:bg-gray-800/50 border-b border-gray-200 dark:border-gray-700">
                  <tr>
                    <th className="text-left px-4 py-3 font-medium text-gray-600 dark:text-gray-400">Status</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-600 dark:text-gray-400">Test</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-600 dark:text-gray-400">Duration</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-600 dark:text-gray-400">Retries</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-600 dark:text-gray-400">Failure</th>
                    <th className="text-right px-4 py-3 font-medium text-gray-600 dark:text-gray-400">Artifacts</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                  {filteredResults.map((result) => (
                    <tr key={result.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                      <td className="px-4 py-3">
                        {STATUS_ICON[result.status] || (
                          <span className="text-gray-400">{result.status}</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <Link
                          to={`/tests/${encodeURIComponent(result.testId)}`}
                          className="text-blue-600 hover:text-blue-800 font-mono text-xs"
                        >
                          {result.testId}
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-gray-600 dark:text-gray-300">
                        {result.durationMs ? `${(result.durationMs / 1000).toFixed(2)}s` : "—"}
                      </td>
                      <td className="px-4 py-3 text-gray-600 dark:text-gray-300">{result.retryCount}</td>
                      <td className="px-4 py-3 text-xs text-gray-500 dark:text-gray-400 max-w-[200px] truncate" title={result.failureSignature || ""}>
                        {result.failureSignature || "—"}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Link
                          to={`/results/${result.id}`}
                          className="inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800"
                        >
                          <ExternalLink className="w-3 h-3" />
                          View
                        </Link>
                      </td>
                    </tr>
                  ))}
                  {filteredResults.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-4 py-8 text-center text-gray-400">
                        {results.length === 0 ? "No results for this run." : "No results match filters."}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
              {filteredResults.length > 0 && (
                <div className="px-4 py-2 border-t border-gray-100 dark:border-gray-700 text-xs text-gray-500 dark:text-gray-400">
                  Showing {filteredResults.length} of {results.length} results
                </div>
              )}
            </div>
          )}
        </>
      )}

      {!selectedRunId && (
        <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-8 text-center text-gray-400">
          Select a run above to view its test results.
        </div>
      )}
    </div>
  );
}
