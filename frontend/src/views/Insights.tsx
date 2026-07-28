import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import {
  Shield,
  Layers,
  TrendingUp,
  Loader2,
  AlertTriangle,
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

export default function Insights() {
  const { data: quarantine, isLoading: qLoading } = useQuery({
    queryKey: ["quarantine"],
    queryFn: () => api.getQuarantine(),
  });

  const { data: clusters, isLoading: cLoading } = useQuery({
    queryKey: ["clusters"],
    queryFn: () => api.getClusters(),
  });

  const { data: trends, isLoading: tLoading } = useQuery({
    queryKey: ["trends"],
    queryFn: () => api.getTrends(),
  });

  const isLoading = qLoading || cLoading || tLoading;

  // Flakiness scores are 0..1; render as a clamped whole-number percentage.
  // Guards against undefined/NaN so the UI never shows "NaN% flaky".
  const pct = (score: number) =>
    Number.isFinite(score) ? Math.round(Math.max(0, Math.min(1, score)) * 100) : 0;

  const durationChartData = (trends?.durationTrend ?? [])
    .slice()
    .reverse()
    .map((d) => ({
      name: new Date(d.createdAt).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
      }),
      avgDuration: d.avgDuration ? Number((d.avgDuration / 1000).toFixed(1)) : 0,
      tests: d.testCount,
    }));

  const passRateChartData = (trends?.passRateTrend ?? [])
    .slice()
    .reverse()
    .map((d) => ({
      name: new Date(d.createdAt).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
      }),
      passRate: d.total > 0 ? Number(((d.passed / d.total) * 100).toFixed(1)) : 0,
      total: d.total,
    }));

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-6">ML Insights</h1>

      {isLoading && (
        <div className="flex items-center justify-center h-32">
          <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Quarantine List */}
        <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-5 shadow-sm">
          <div className="flex items-center gap-2 mb-4">
            <Shield className="w-5 h-5 text-orange-500" />
            <h2 className="font-semibold text-gray-900 dark:text-gray-100">Quarantined Tests</h2>
          </div>
          {(quarantine?.quarantined ?? []).length === 0 ? (
            <p className="text-sm text-gray-400">
              No quarantined tests. Flakiness analysis needs run history to
              activate.
            </p>
          ) : (
            <ul className="space-y-2">
              {quarantine!.quarantined.map((q) => (
                <li
                  key={q.testId}
                  className="flex items-center justify-between p-2 bg-orange-50 dark:bg-orange-900/20 rounded text-sm"
                >
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="w-3.5 h-3.5 text-orange-500" />
                    <span className="font-mono text-xs truncate max-w-xs">
                      {q.testId}
                    </span>
                  </div>
                  <span className="text-xs text-orange-700 font-medium">
                    {pct(q.flakinessScore)}% flaky
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Failure Clusters */}
        <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-5 shadow-sm">
          <div className="flex items-center gap-2 mb-4">
            <Layers className="w-5 h-5 text-purple-500" />
            <h2 className="font-semibold text-gray-900 dark:text-gray-100">Failure Clusters</h2>
          </div>
          {(clusters?.clusters ?? []).length === 0 ? (
            <p className="text-sm text-gray-400">
              No failure clusters yet. Clustering activates after enough
              failures accumulate.
            </p>
          ) : (
            <ul className="space-y-2">
              {clusters!.clusters.map((c) => (
                <li
                  key={c.id}
                  className="p-2 bg-purple-50 dark:bg-purple-900/20 rounded text-sm"
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-medium text-purple-800 dark:text-purple-300">
                      {c.size} failures
                    </span>
                    <span className="text-xs text-gray-500">
                      Last: {new Date(c.last_seen).toLocaleDateString()}
                    </span>
                  </div>
                  <p className="text-xs text-gray-600 dark:text-gray-400 truncate">
                    {c.representative}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Duration Trend */}
        <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-5 shadow-sm lg:col-span-2">
          <div className="flex items-center gap-2 mb-4">
            <TrendingUp className="w-5 h-5 text-blue-500" />
            <h2 className="font-semibold text-gray-900 dark:text-gray-100">Duration Trend</h2>
          </div>
          {durationChartData.length === 0 ? (
            <p className="text-sm text-gray-400">
              No trend data yet. Trends populate as run history grows.
            </p>
          ) : (
            <ResponsiveContainer width="100%" height={250}>
              <LineChart data={durationChartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                <YAxis
                  tick={{ fontSize: 11 }}
                  label={{
                    value: "Avg Duration (s)",
                    angle: -90,
                    position: "insideLeft",
                    style: { fontSize: 11 },
                  }}
                />
                <Tooltip />
                <Line
                  type="monotone"
                  dataKey="avgDuration"
                  stroke="#3b82f6"
                  strokeWidth={2}
                  dot={{ r: 3 }}
                />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Pass Rate Trend (#11) */}
        <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-5 shadow-sm lg:col-span-2">
          <div className="flex items-center gap-2 mb-4">
            <TrendingUp className="w-5 h-5 text-green-500" />
            <h2 className="font-semibold text-gray-900 dark:text-gray-100">Pass Rate Trend</h2>
          </div>
          {passRateChartData.length === 0 ? (
            <p className="text-sm text-gray-400">
              No trend data yet. Pass rate populates as run history grows.
            </p>
          ) : (
            <ResponsiveContainer width="100%" height={250}>
              <LineChart data={passRateChartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                <YAxis
                  domain={[0, 100]}
                  tick={{ fontSize: 11 }}
                  label={{
                    value: "Pass Rate (%)",
                    angle: -90,
                    position: "insideLeft",
                    style: { fontSize: 11 },
                  }}
                />
                <Tooltip />
                <Line
                  type="monotone"
                  dataKey="passRate"
                  stroke="#22c55e"
                  strokeWidth={2}
                  dot={{ r: 3 }}
                />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Flaky Tests */}
        {(trends?.flakyTests ?? []).length > 0 && (
          <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-5 shadow-sm lg:col-span-2">
            <h2 className="font-semibold text-gray-900 dark:text-gray-100 mb-3">
              Rising Flakiness
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {trends!.flakyTests.map((t) => (
                <div
                  key={t.testId}
                  className={`p-3 rounded border ${
                    t.quarantined
                      ? "border-orange-200 bg-orange-50"
                      : "border-yellow-200 bg-yellow-50"
                  }`}
                >
                  <p className="font-mono text-xs truncate">{t.testId}</p>
                  <p className="text-sm font-medium mt-1">
                    {pct(t.flakinessScore)}% flaky
                    {t.quarantined && (
                      <span className="text-xs text-orange-600 ml-2">
                        (quarantined)
                      </span>
                    )}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
