import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { api } from "../api";
import { Play, Loader2, SlidersHorizontal } from "lucide-react";
import {
  type RunTargetConfig,
  defaultRunTargetConfig,
  runConfigToPayload,
  TestSelectorField,
  TargetAuthFields,
} from "../components/RunConfigFields";
import {
  type EnvOverridesForm,
  emptyEnvOverridesForm,
  toEnvOverridesPayload,
  TIMEZONE_OPTIONS,
} from "../runEnvOverrides";

export default function TriggerRun() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [config, setConfig] = useState<RunTargetConfig>(defaultRunTargetConfig);
  const [search, setSearch] = useState("");
  const [envForm, setEnvForm] = useState<EnvOverridesForm>(emptyEnvOverridesForm);
  const [showOverrides, setShowOverrides] = useState(false);
  const [shards, setShards] = useState(1);
  const grafanaVersion = "11.4.0";

  const patch = (p: Partial<RunTargetConfig>) => setConfig((c) => ({ ...c, ...p }));
  const patchEnv = (p: Partial<EnvOverridesForm>) =>
    setEnvForm((f) => ({ ...f, ...p }));

  const canRun = config.mode === "preset" ? true : config.selectedTestIds.length > 0;

  const mutation = useMutation({
    mutationFn: () =>
      api.triggerRun({
        ...runConfigToPayload(config),
        grafanaVersion,
        triggerSource: "manual",
        envOverrides: toEnvOverridesPayload(envForm),
        shards: shards > 1 ? shards : undefined,
      }),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["runs"] });
      navigate(`/runs/${data.runId}`);
    },
  });

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-6">Trigger a Run</h1>

      <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6 shadow-sm space-y-5">
        <TestSelectorField
          config={config}
          onChange={patch}
          search={search}
          onSearchChange={setSearch}
        />

        {/* Target application + authentication */}
        <div className="border-t border-gray-100 dark:border-gray-700 pt-4">
          <TargetAuthFields config={config} onChange={patch} />
        </div>

        {/* Per-run environment overrides (#15) */}
        <div className="border-t border-gray-100 dark:border-gray-700 pt-4">
          <button
            type="button"
            onClick={() => setShowOverrides((s) => !s)}
            className="flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:text-orange-600"
          >
            <SlidersHorizontal className="w-4 h-4" />
            Environment overrides
            <span className="text-xs text-gray-400">(optional)</span>
          </button>

          {showOverrides && (
            <div className="mt-3 space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
                  Viewport (px)
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min={320}
                    placeholder="Width"
                    value={envForm.viewportWidth}
                    onChange={(e) => patchEnv({ viewportWidth: e.target.value })}
                    className="w-28 text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 rounded-md px-2 py-1.5 outline-none focus:ring-2 focus:ring-orange-400"
                  />
                  <span className="text-gray-400">×</span>
                  <input
                    type="number"
                    min={240}
                    placeholder="Height"
                    value={envForm.viewportHeight}
                    onChange={(e) => patchEnv({ viewportHeight: e.target.value })}
                    className="w-28 text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 rounded-md px-2 py-1.5 outline-none focus:ring-2 focus:ring-orange-400"
                  />
                </div>
                <p className="text-[11px] text-gray-400 mt-1">
                  Both width and height are required to override the viewport.
                </p>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
                  Timezone
                </label>
                <select
                  value={envForm.timezone}
                  onChange={(e) => patchEnv({ timezone: e.target.value })}
                  className="text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 rounded-md px-2 py-1.5 outline-none focus:ring-2 focus:ring-orange-400"
                >
                  {TIMEZONE_OPTIONS.map((tz) => (
                    <option key={tz.value} value={tz.value}>
                      {tz.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
                  Dashboard time range
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    placeholder="From (e.g. now-6h)"
                    value={envForm.timeFrom}
                    onChange={(e) => patchEnv({ timeFrom: e.target.value })}
                    className="flex-1 text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 rounded-md px-2 py-1.5 outline-none focus:ring-2 focus:ring-orange-400"
                  />
                  <span className="text-gray-400">→</span>
                  <input
                    type="text"
                    placeholder="To (e.g. now)"
                    value={envForm.timeTo}
                    onChange={(e) => patchEnv({ timeTo: e.target.value })}
                    className="flex-1 text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 rounded-md px-2 py-1.5 outline-none focus:ring-2 focus:ring-orange-400"
                  />
                </div>
                <p className="text-[11px] text-gray-400 mt-1">
                  Relative (now-6h) or absolute epoch-ms. Honored by specs that read
                  RUN_TIME_FROM / RUN_TIME_TO.
                </p>
              </div>

              {/* Parallel sharding (#13) */}
              <div>
                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
                  Parallel shards
                </label>
                <select
                  value={shards}
                  onChange={(e) => setShards(Number(e.target.value))}
                  className="text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 rounded-md px-2 py-1.5 outline-none focus:ring-2 focus:ring-orange-400"
                >
                  {[1, 2, 3, 4, 6, 8].map((n) => (
                    <option key={n} value={n}>
                      {n === 1 ? "1 (no sharding)" : `${n} shards`}
                    </option>
                  ))}
                </select>
                <p className="text-[11px] text-gray-400 mt-1">
                  Splits the suite across N parallel Playwright workers; results are
                  merged into this one run.
                </p>
              </div>
            </div>
          )}
        </div>

        <button
          onClick={() => mutation.mutate()}
          disabled={mutation.isPending || !canRun}
          className="w-full flex items-center justify-center gap-2 bg-orange-500 hover:bg-orange-600 disabled:bg-orange-300 disabled:cursor-not-allowed text-white font-medium py-2.5 px-4 rounded-md transition-colors"
        >
          {mutation.isPending ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Play className="w-4 h-4" />
          )}
          {mutation.isPending
            ? "Triggering..."
            : config.mode === "individual"
            ? `Run ${config.selectedTestIds.length || ""} Test${config.selectedTestIds.length === 1 ? "" : "s"}`.trim()
            : "Start Run"}
        </button>

        {config.mode === "individual" && !canRun && (
          <p className="text-xs text-gray-500 dark:text-gray-400 text-center">
            Select at least one test to run.
          </p>
        )}

        {mutation.isError && (
          <p className="text-sm text-red-600">
            Error: {(mutation.error as Error).message}
          </p>
        )}
      </div>
    </div>
  );
}
