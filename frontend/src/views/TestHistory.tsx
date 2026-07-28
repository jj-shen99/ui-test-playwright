import { useParams, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import { ArrowLeft, Loader2 } from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";

export default function TestHistory() {
  const { testId } = useParams<{ testId: string }>();
  const decodedTestId = testId ? decodeURIComponent(testId) : "";

  const { data, isLoading } = useQuery({
    queryKey: ["test-history", decodedTestId],
    queryFn: () => api.getTestHistory(decodedTestId),
    enabled: !!decodedTestId,
  });

  const history = data?.history ?? [];

  const chartData = [...history]
    .reverse()
    .slice(-30)
    .map((h, i) => ({
      idx: i,
      duration: h.durationMs ? h.durationMs / 1000 : 0,
      status: h.status,
      commit: h.commitSha?.slice(0, 7) ?? "",
    }));

  const barColor = (status: string) =>
    status === "passed"
      ? "#22c55e"
      : status === "flaky"
        ? "#eab308"
        : "#ef4444";

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <Link
        to="/tests"
        className="text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 flex items-center gap-1 mb-4"
      >
        <ArrowLeft className="w-3 h-3" /> Back to catalog
      </Link>

      <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100 mb-1">Test History</h1>
      <p className="text-sm text-gray-500 dark:text-gray-400 font-mono mb-6">{decodedTestId}</p>

      {isLoading ? (
        <div className="flex items-center justify-center h-64">
          <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
        </div>
      ) : (
        <>
          {/* Duration chart */}
          {chartData.length > 0 && (
            <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4 mb-6 shadow-sm">
              <h2 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
                Duration (last 30 runs)
              </h2>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="commit" tick={{ fontSize: 10 }} />
                  <YAxis
                    tick={{ fontSize: 10 }}
                    label={{
                      value: "seconds",
                      angle: -90,
                      position: "insideLeft",
                      style: { fontSize: 10 },
                    }}
                  />
                  <Tooltip />
                  <Bar dataKey="duration">
                    {chartData.map((entry, i) => (
                      <Cell key={i} fill={barColor(entry.status)} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* History table */}
          <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-gray-800/50 border-b border-gray-200 dark:border-gray-700">
                <tr>
                  <th className="text-left px-4 py-3 font-medium text-gray-600 dark:text-gray-400">
                    Status
                  </th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600 dark:text-gray-400">
                    Commit
                  </th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600 dark:text-gray-400">
                    Duration
                  </th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600 dark:text-gray-400">
                    Retries
                  </th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600 dark:text-gray-400">
                    Date
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                {history.map((h) => (
                  <tr key={h.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                    <td className="px-4 py-3">
                      <span
                        className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                          h.status === "passed"
                            ? "bg-green-100 text-green-700"
                            : h.status === "flaky"
                              ? "bg-yellow-100 text-yellow-700"
                              : "bg-red-100 text-red-700"
                        }`}
                      >
                        {h.status}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <code className="text-xs bg-gray-100 dark:bg-gray-700 dark:text-gray-300 px-1.5 py-0.5 rounded">
                        {h.commitSha?.slice(0, 7)}
                      </code>
                    </td>
                    <td className="px-4 py-3 text-gray-600 dark:text-gray-300">
                      {h.durationMs
                        ? `${(h.durationMs / 1000).toFixed(1)}s`
                        : "—"}
                    </td>
                    <td className="px-4 py-3 text-gray-600 dark:text-gray-300">
                      {h.retryCount}
                    </td>
                    <td className="px-4 py-3 text-gray-500 dark:text-gray-400 text-xs">
                      {new Date(h.createdAt).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
