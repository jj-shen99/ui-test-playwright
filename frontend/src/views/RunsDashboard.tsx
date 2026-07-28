import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api } from "../api";
import { useCurrentUser, isAdmin } from "../useCurrentUser";
import {
  CheckCircle,
  XCircle,
  Clock,
  AlertTriangle,
  Loader2,
  Trash2,
} from "lucide-react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

const statusIcon: Record<string, React.ReactNode> = {
  passed: <CheckCircle className="w-4 h-4 text-green-500" />,
  failed: <XCircle className="w-4 h-4 text-red-500" />,
  running: <Loader2 className="w-4 h-4 text-blue-500 animate-spin" />,
  queued: <Clock className="w-4 h-4 text-gray-400" />,
  error: <AlertTriangle className="w-4 h-4 text-orange-500" />,
};

const statusBadge: Record<string, string> = {
  passed: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
  failed: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
  running: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
  queued: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400",
  error: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400",
};

export default function RunsDashboard() {
  const queryClient = useQueryClient();
  const userIsAdmin = isAdmin(useCurrentUser());
  const { data, isLoading } = useQuery({
    queryKey: ["runs"],
    queryFn: () => api.getRuns(50),
    refetchInterval: 5000,
  });

  const deleteRun = useMutation({
    mutationFn: (id: string) => api.deleteRun(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["runs"] });
    },
    onError: (err: unknown) => {
      alert(err instanceof Error ? err.message : "Failed to delete run.");
    },
  });

  const handleDelete = (id: string) => {
    if (window.confirm("Delete this run and all of its results? This cannot be undone.")) {
      deleteRun.mutate(id);
    }
  };

  const runs = data?.runs ?? [];

  const chartData = [...runs]
    .reverse()
    .slice(-20)
    .map((r) => ({
      name: new Date(r.createdAt).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      }),
      status: r.status === "passed" ? 1 : 0,
    }));

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-6">
        Results Dashboard
      </h1>

      {/* Summary cards */}
      <div className="grid grid-cols-4 gap-4 mb-8">
        {[
          {
            label: "Total Runs",
            value: runs.length,
            color: "text-gray-900",
          },
          {
            label: "Passed",
            value: runs.filter((r) => r.status === "passed").length,
            color: "text-green-600",
          },
          {
            label: "Failed",
            value: runs.filter((r) => r.status === "failed").length,
            color: "text-red-600",
          },
          {
            label: "Running",
            value: runs.filter((r) =>
              ["running", "queued"].includes(r.status)
            ).length,
            color: "text-blue-600",
          },
        ].map((card) => (
          <div
            key={card.label}
            className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4 shadow-sm"
          >
            <p className="text-sm text-gray-500 dark:text-gray-400">{card.label}</p>
            <p className={`text-3xl font-bold ${card.color}`}>{card.value}</p>
          </div>
        ))}
      </div>

      {/* Pass rate chart */}
      {chartData.length > 1 && (
        <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4 mb-8 shadow-sm">
          <h2 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
            Pass Rate Trend
          </h2>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis
                dataKey="name"
                tick={{ fontSize: 11 }}
                stroke="#9ca3af"
              />
              <YAxis
                domain={[0, 1]}
                tickFormatter={(v) => `${(v * 100).toFixed(0)}%`}
                tick={{ fontSize: 11 }}
                stroke="#9ca3af"
              />
              <Tooltip
                formatter={(v: number) => `${(v * 100).toFixed(0)}%`}
              />
              <Line
                type="monotone"
                dataKey="status"
                stroke="#22c55e"
                strokeWidth={2}
                dot={{ r: 3 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Runs table */}
      <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 dark:bg-gray-800/50 border-b border-gray-200 dark:border-gray-700">
            <tr>
              <th className="text-left px-4 py-3 font-medium text-gray-600 dark:text-gray-400">
                Status
              </th>
              <th className="text-left px-4 py-3 font-medium text-gray-600 dark:text-gray-400">
                Trigger
              </th>
              <th className="text-left px-4 py-3 font-medium text-gray-600 dark:text-gray-400">
                Commit
              </th>
              <th className="text-left px-4 py-3 font-medium text-gray-600 dark:text-gray-400">
                Selector
              </th>
              <th className="text-left px-4 py-3 font-medium text-gray-600 dark:text-gray-400">
                Started
              </th>
              <th className="text-left px-4 py-3 font-medium text-gray-600 dark:text-gray-400">
                Duration
              </th>
              {userIsAdmin && (
                <th className="text-right px-4 py-3 font-medium text-gray-600 dark:text-gray-400">
                  Actions
                </th>
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
            {isLoading && (
              <tr>
                <td colSpan={userIsAdmin ? 7 : 6} className="text-center py-12 text-gray-400">
                  <Loader2 className="w-5 h-5 animate-spin inline mr-2" />
                  Loading...
                </td>
              </tr>
            )}
            {runs.map((run) => (
              <tr key={run.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors">
                <td className="px-4 py-3">
                  <Link
                    to={`/runs/${run.id}`}
                    className="flex items-center gap-2"
                  >
                    {statusIcon[run.status] || statusIcon.error}
                    <span
                      className={`text-xs font-medium px-2 py-0.5 rounded-full ${statusBadge[run.status] || statusBadge.error}`}
                    >
                      {run.status}
                    </span>
                  </Link>
                </td>
                <td className="px-4 py-3 text-gray-600 dark:text-gray-300">
                  {run.triggerSource}
                </td>
                <td className="px-4 py-3">
                  <code className="text-xs bg-gray-100 dark:bg-gray-700 dark:text-gray-300 px-1.5 py-0.5 rounded">
                    {run.commitSha.slice(0, 7)}
                  </code>
                </td>
                <td className="px-4 py-3 text-gray-600 dark:text-gray-300">{run.selector}</td>
                <td className="px-4 py-3 text-gray-500 dark:text-gray-400 text-xs">
                  {run.startedAt
                    ? new Date(run.startedAt).toLocaleString()
                    : "—"}
                </td>
                <td className="px-4 py-3 text-gray-500 dark:text-gray-400 text-xs">
                  {run.startedAt && run.finishedAt
                    ? `${((new Date(run.finishedAt).getTime() - new Date(run.startedAt).getTime()) / 1000).toFixed(1)}s`
                    : "—"}
                </td>
                {userIsAdmin && (
                  <td className="px-4 py-3 text-right">
                    {["queued", "running"].includes(run.status) ? (
                      <span
                        className="text-gray-300 dark:text-gray-600 cursor-not-allowed"
                        title="Cannot delete a run that is queued or running"
                      >
                        <Trash2 className="w-4 h-4 inline" />
                      </span>
                    ) : (
                      <button
                        onClick={() => handleDelete(run.id)}
                        disabled={deleteRun.isPending && deleteRun.variables === run.id}
                        className="text-gray-400 hover:text-red-600 dark:hover:text-red-400 transition-colors disabled:opacity-50"
                        title="Delete run"
                        aria-label="Delete run"
                      >
                        {deleteRun.isPending && deleteRun.variables === run.id ? (
                          <Loader2 className="w-4 h-4 inline animate-spin" />
                        ) : (
                          <Trash2 className="w-4 h-4 inline" />
                        )}
                      </button>
                    )}
                  </td>
                )}
              </tr>
            ))}
            {!isLoading && runs.length === 0 && (
              <tr>
                <td colSpan={userIsAdmin ? 7 : 6} className="text-center py-12 text-gray-400">
                  No runs yet. Trigger one from the sidebar.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
