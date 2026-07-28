import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Calendar, Plus, Play, Trash2, Clock } from "lucide-react";
import { api } from "../api";
import { useCurrentUser, isAdmin } from "../useCurrentUser";
import {
  type RunTargetConfig,
  defaultRunTargetConfig,
  runConfigToPayload,
  TestSelectorField,
  TargetAuthFields,
} from "../components/RunConfigFields";

export default function Schedules() {
  const queryClient = useQueryClient();
  const userIsAdmin = isAdmin(useCurrentUser());
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    name: "",
    cronExpression: "0 2 * * *",
  });
  const [config, setConfig] = useState<RunTargetConfig>(defaultRunTargetConfig);
  const [search, setSearch] = useState("");

  const patch = (p: Partial<RunTargetConfig>) => setConfig((c) => ({ ...c, ...p }));

  const resetForm = () => {
    setForm({ name: "", cronExpression: "0 2 * * *" });
    setConfig(defaultRunTargetConfig);
    setSearch("");
  };

  const { data, isLoading, error } = useQuery({
    queryKey: ["schedules"],
    queryFn: api.getSchedules,
  });

  const createMutation = useMutation({
    mutationFn: () => {
      const payload = runConfigToPayload(config);
      return api.createSchedule({
        name: form.name,
        cronExpression: form.cronExpression,
        ...payload,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["schedules"] });
      setShowForm(false);
      resetForm();
    },
  });

  const canCreate =
    form.name.trim().length > 0 &&
    form.cronExpression.trim().length > 0 &&
    (config.mode === "preset" || config.selectedTestIds.length > 0);

  const deleteMutation = useMutation({
    mutationFn: api.deleteSchedule,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["schedules"] }),
  });

  const triggerMutation = useMutation({
    mutationFn: api.triggerSchedule,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["schedules"] }),
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      api.updateSchedule(id, { enabled }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["schedules"] }),
  });

  if (isLoading) return <div className="p-8 text-gray-500">Loading schedules...</div>;
  if (error) return <div className="p-8 text-red-500">Error loading schedules</div>;

  const schedules = data?.schedules || [];

  return (
    <div className="p-8 max-w-5xl">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Calendar className="w-6 h-6 text-gray-700 dark:text-gray-300" />
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Test Schedules</h1>
        </div>
        <button
          onClick={() => setShowForm(!showForm)}
          className="flex items-center gap-2 px-4 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600 transition-colors"
        >
          <Plus className="w-4 h-4" />
          New Schedule
        </button>
      </div>

      {/* Create Schedule Form */}
      {showForm && (
        <div className="mb-6 p-4 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-sm max-w-2xl space-y-4">
          <h3 className="font-semibold dark:text-gray-100">New Schedule</h3>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Schedule Name
              </label>
              <input
                placeholder="e.g. Nightly Full Suite"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 rounded-md text-sm focus:ring-2 focus:ring-orange-400 outline-none"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Cron Expression
              </label>
              <input
                placeholder="0 2 * * *"
                value={form.cronExpression}
                onChange={(e) => setForm({ ...form, cronExpression: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 rounded-md text-sm font-mono focus:ring-2 focus:ring-orange-400 outline-none"
              />
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                minute hour dayOfMonth month dayOfWeek (e.g. "0 2 * * *" = 2am daily)
              </p>
            </div>
          </div>

          {/* Same test selector as /trigger */}
          <div className="border-t border-gray-100 dark:border-gray-700 pt-4">
            <TestSelectorField
              config={config}
              onChange={patch}
              search={search}
              onSearchChange={setSearch}
            />
          </div>

          {/* Target application + authentication (persisted for unattended runs) */}
          <div className="border-t border-gray-100 dark:border-gray-700 pt-4">
            <TargetAuthFields config={config} onChange={patch} persisted />
          </div>

          <div className="flex gap-2">
            <button
              onClick={() => createMutation.mutate()}
              disabled={createMutation.isPending || !canCreate}
              className="px-4 py-2 bg-green-600 text-white rounded-md text-sm hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {createMutation.isPending ? "Creating..." : "Create Schedule"}
            </button>
            <button
              onClick={() => {
                setShowForm(false);
                resetForm();
              }}
              className="px-4 py-2 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-md text-sm hover:bg-gray-300 dark:hover:bg-gray-600"
            >
              Cancel
            </button>
          </div>
          {config.mode === "individual" && config.selectedTestIds.length === 0 && (
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Select at least one test, or switch to a preset suite.
            </p>
          )}
          {createMutation.isError && (
            <p className="text-red-500 text-sm">{(createMutation.error as Error).message}</p>
          )}
        </div>
      )}

      {/* Schedules Table */}
      <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 dark:bg-gray-800/50 border-b border-gray-200 dark:border-gray-700">
            <tr>
              <th className="text-left px-4 py-3 font-medium text-gray-600 dark:text-gray-400">Name</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600 dark:text-gray-400">Cron</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600 dark:text-gray-400">Selector</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600 dark:text-gray-400">Status</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600 dark:text-gray-400">Next Run</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600 dark:text-gray-400">Last Run</th>
              <th className="text-right px-4 py-3 font-medium text-gray-600 dark:text-gray-400">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
            {schedules.map((schedule: any) => (
              <tr key={schedule.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                <td className="px-4 py-3 font-medium text-gray-900 dark:text-gray-100">{schedule.name}</td>
                <td className="px-4 py-3">
                  <code className="px-1.5 py-0.5 bg-gray-100 dark:bg-gray-700 dark:text-gray-300 rounded text-xs">
                    {schedule.cronExpression}
                  </code>
                </td>
                <td className="px-4 py-3 text-gray-600 dark:text-gray-300">{schedule.selector}</td>
                <td className="px-4 py-3">
                  <button
                    onClick={() => toggleMutation.mutate({ id: schedule.id, enabled: !schedule.enabled })}
                    className={`px-2 py-0.5 rounded text-xs font-medium cursor-pointer ${
                      schedule.enabled ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400" : "bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400"
                    }`}
                  >
                    {schedule.enabled ? "Enabled" : "Disabled"}
                  </button>
                </td>
                <td className="px-4 py-3 text-gray-500 dark:text-gray-400 text-xs">
                  <div className="flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    {schedule.nextRunAt ? new Date(schedule.nextRunAt).toLocaleString() : "—"}
                  </div>
                </td>
                <td className="px-4 py-3 text-gray-500 dark:text-gray-400 text-xs">
                  {schedule.lastRunAt ? new Date(schedule.lastRunAt).toLocaleString() : "Never"}
                </td>
                <td className="px-4 py-3 text-right flex items-center justify-end gap-1">
                  <button
                    onClick={() => triggerMutation.mutate(schedule.id)}
                    disabled={triggerMutation.isPending}
                    className="p-1 text-gray-400 hover:text-green-600"
                    title="Run now"
                  >
                    <Play className="w-4 h-4" />
                  </button>
                  {userIsAdmin && (
                    <button
                      onClick={() => {
                        if (confirm(`Delete schedule "${schedule.name}"?`)) {
                          deleteMutation.mutate(schedule.id);
                        }
                      }}
                      className="p-1 text-gray-400 hover:text-red-500"
                      title="Delete"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {schedules.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-gray-400">
                  No schedules configured. Click "New Schedule" to create one.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
