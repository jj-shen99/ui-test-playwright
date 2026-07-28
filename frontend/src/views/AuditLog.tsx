import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import { useCurrentUser, isAdmin } from "../useCurrentUser";
import { ScrollText, Loader2, ShieldAlert } from "lucide-react";

/** Human-friendly label + color for each audit action prefix. */
function actionStyle(action: string): { label: string; className: string } {
  const [domain, verb] = action.split(".");
  const isDelete = verb === "delete";
  const isCreate = verb === "create" || verb === "trigger" || verb === "run";
  const className = isDelete
    ? "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300"
    : isCreate
      ? "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300"
      : "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300";
  const label = `${domain}.${verb ?? ""}`.replace(/\.$/, "");
  return { label, className };
}

export default function AuditLog() {
  const userIsAdmin = isAdmin(useCurrentUser());

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["audit"],
    queryFn: () => api.getAudit(200),
    enabled: userIsAdmin,
    refetchInterval: 15000,
  });

  if (!userIsAdmin) {
    return (
      <div className="p-8 max-w-3xl">
        <div className="flex items-center gap-3 text-gray-600 dark:text-gray-300">
          <ShieldAlert className="w-5 h-5 text-orange-500" />
          <p>You need administrator access to view the audit log.</p>
        </div>
      </div>
    );
  }

  const entries = data?.entries ?? [];

  return (
    <div className="p-8 max-w-5xl">
      <div className="flex items-center gap-3 mb-2">
        <ScrollText className="w-6 h-6 text-gray-700 dark:text-gray-300" />
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Audit Log</h1>
      </div>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
        Record of sensitive actions — runs triggered/deleted, schedule and user changes,
        and credential management. Most recent first.
      </p>

      {isLoading ? (
        <div className="flex items-center gap-2 text-gray-500">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading…
        </div>
      ) : isError ? (
        <p className="text-red-500 text-sm">
          Failed to load audit log: {(error as Error).message}
        </p>
      ) : entries.length === 0 ? (
        <p className="text-gray-500 text-sm">No audit entries recorded yet.</p>
      ) : (
        <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-800/50 border-b border-gray-200 dark:border-gray-700">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-gray-600 dark:text-gray-400">When</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600 dark:text-gray-400">Actor</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600 dark:text-gray-400">Action</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600 dark:text-gray-400">Detail</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
              {entries.map((e) => {
                const style = actionStyle(e.action);
                return (
                  <tr key={e.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                    <td className="px-4 py-3 text-gray-500 dark:text-gray-400 whitespace-nowrap">
                      {new Date(e.createdAt).toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-gray-700 dark:text-gray-300">
                      {e.actorEmail || (
                        <span className="text-gray-400 italic">system / unknown</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full font-mono ${style.className}`}>
                        {style.label}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-600 dark:text-gray-300">
                      {e.detail || "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
