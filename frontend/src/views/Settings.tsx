import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { NavLink, Outlet } from "react-router-dom";
import { api } from "../api";
import { useCurrentUser, isAdmin } from "../useCurrentUser";
import {
  Settings as SettingsIcon,
  GitBranch,
  Server,
  Pencil,
  Check,
  X,
  Loader2,
  Lock,
  KeyRound,
  ScrollText,
} from "lucide-react";

interface ConfigItem {
  label: string;
  key: string;
  defaultValue: string;
  type?: "text" | "password";
}

interface ConfigSection {
  title: string;
  icon: typeof GitBranch;
  items: ConfigItem[];
}

const SECTIONS: ConfigSection[] = [
  {
    title: "Test Repository",
    icon: GitBranch,
    items: [
      { label: "Repository URL", key: "testRepoUrl", defaultValue: "https://code.devsnc.com/jianjun-shen/grafana-ui-testing" },
      { label: "Default Branch", key: "testRepoBranch", defaultValue: "main" },
    ],
  },
  {
    title: "API Server",
    icon: Server,
    items: [
      { label: "Endpoint", key: "apiEndpoint", defaultValue: "http://localhost:6199" },
    ],
  },
  {
    title: "Environment",
    icon: SettingsIcon,
    items: [
      { label: "Grafana URL", key: "grafanaUrl", defaultValue: "http://localhost:3000" },
      { label: "VictoriaMetrics", key: "victoriaMetricsUrl", defaultValue: "http://localhost:8428" },
    ],
  },
];

function EditableRow({
  label,
  value,
  defaultValue,
  onSave,
  isSaving,
  canEdit,
  type = "text",
}: {
  label: string;
  value: string;
  defaultValue: string;
  onSave: (newValue: string) => void;
  isSaving: boolean;
  canEdit: boolean;
  type?: "text" | "password";
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  const handleSave = () => {
    if (draft !== value) {
      onSave(draft);
    }
    setEditing(false);
  };

  const handleCancel = () => {
    setDraft(value);
    setEditing(false);
  };

  const isDefault = value === defaultValue;
  const isSecret = type === "password";
  const displayValue = isSecret
    ? value
      ? "\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022"
      : "— not set —"
    : value || "— not set —";

  return (
    <div className="px-4 py-3">
      <div className="flex items-center justify-between gap-4">
        <span className="text-sm text-gray-600 dark:text-gray-400 shrink-0">{label}</span>
        {editing ? (
          <div className="flex items-center gap-2 flex-1 min-w-0 justify-end">
            <input
              type={isSecret ? "password" : "text"}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSave();
                if (e.key === "Escape") handleCancel();
              }}
              autoFocus
              autoComplete={isSecret ? "new-password" : "off"}
              className="flex-1 min-w-0 px-2 py-1 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 rounded text-sm font-mono focus:ring-2 focus:ring-orange-300 focus:border-orange-400 outline-none"
            />
            <button
              onClick={handleSave}
              disabled={isSaving}
              className="p-1 text-green-600 hover:text-green-700 disabled:opacity-50"
              title="Save"
            >
              {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
            </button>
            <button
              onClick={handleCancel}
              className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
              title="Cancel"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-sm text-gray-900 dark:text-gray-200 font-mono truncate">{displayValue}</span>
            {canEdit && (
              <button
                onClick={() => setEditing(true)}
                className="p-1 text-gray-400 hover:text-orange-500 shrink-0"
                title="Edit"
              >
                <Pencil className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        )}
      </div>
      {!editing && !isSecret && defaultValue !== "" && (
        <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
          Default: <span className="font-mono">{defaultValue}</span>
          {!isDefault && <span className="ml-1 text-orange-500">(overridden)</span>}
        </p>
      )}
    </div>
  );
}

interface AuthKeys {
  type: string;
  user: string;
  password: string;
  token: string;
}

/** Default authentication configuration for a target service (Grafana / VM). */
function AuthSection({
  title,
  keys,
  config,
  canEdit,
  onSave,
  isSaving,
}: {
  title: string;
  keys: AuthKeys;
  config: Record<string, string> | undefined;
  canEdit: boolean;
  onSave: (key: string, value: string) => void;
  isSaving: boolean;
}) {
  const authType = config?.[keys.type] ?? "none";

  return (
    <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
      <div className="px-4 py-3 bg-gray-50 dark:bg-gray-800/50 border-b border-gray-200 dark:border-gray-700 flex items-center gap-2">
        <Lock className="w-4 h-4 text-gray-500 dark:text-gray-400" />
        <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300">{title}</h2>
      </div>
      <div className="divide-y divide-gray-100 dark:divide-gray-700">
        <div className="px-4 py-3 flex items-center justify-between gap-4">
          <span className="text-sm text-gray-600 dark:text-gray-400 shrink-0">
            Authentication
          </span>
          <select
            value={authType}
            disabled={!canEdit || isSaving}
            onChange={(e) => onSave(keys.type, e.target.value)}
            className="px-2 py-1 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 rounded text-sm focus:ring-2 focus:ring-orange-300 focus:border-orange-400 outline-none disabled:opacity-50"
          >
            <option value="none">None</option>
            <option value="basic">Username &amp; Password</option>
            <option value="token">API Token</option>
          </select>
        </div>

        {authType === "basic" && (
          <>
            <EditableRow
              label="Username"
              value={config?.[keys.user] ?? ""}
              defaultValue=""
              onSave={(v) => onSave(keys.user, v)}
              isSaving={isSaving}
              canEdit={canEdit}
            />
            <EditableRow
              label="Password"
              type="password"
              value={config?.[keys.password] ?? ""}
              defaultValue=""
              onSave={(v) => onSave(keys.password, v)}
              isSaving={isSaving}
              canEdit={canEdit}
            />
          </>
        )}

        {authType === "token" && (
          <EditableRow
            label="API Token"
            type="password"
            value={config?.[keys.token] ?? ""}
            defaultValue=""
            onSave={(v) => onSave(keys.token, v)}
            isSaving={isSaving}
            canEdit={canEdit}
          />
        )}

        {authType !== "none" && (
          <p className="px-4 py-2 text-xs text-gray-400 dark:text-gray-500">
            Used as the default credentials when a run or test generation targets
            this service without supplying its own.
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * The "General" settings tab: editable app configuration and default
 * Grafana/VictoriaMetrics authentication. Rendered inside the Settings tab
 * layout below.
 */
export function GeneralSettings() {
  const queryClient = useQueryClient();
  const currentUser = useCurrentUser();
  const canEdit = isAdmin(currentUser);

  const { data: config, isLoading } = useQuery({
    queryKey: ["config"],
    queryFn: api.getConfig,
  });

  const mutation = useMutation({
    mutationFn: (body: Record<string, string>) => api.updateConfig(body),
    onSuccess: (data) => {
      queryClient.setQueryData(["config"], data);
    },
  });

  const handleSave = (key: string, value: string) => {
    mutation.mutate({ [key]: value });
  };

  return (
    <div className="px-8 py-6 max-w-4xl">
      {isLoading ? (
        <p className="text-gray-500">Loading configuration...</p>
      ) : (
        <div className="space-y-6">
          {SECTIONS.map((section) => (
            <div key={section.title} className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
              <div className="px-4 py-3 bg-gray-50 dark:bg-gray-800/50 border-b border-gray-200 dark:border-gray-700 flex items-center gap-2">
                <section.icon className="w-4 h-4 text-gray-500 dark:text-gray-400" />
                <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300">{section.title}</h2>
              </div>
              <div className="divide-y divide-gray-100 dark:divide-gray-700">
                {section.items.map((item) => (
                  <EditableRow
                    key={item.key}
                    label={item.label}
                    type={item.type}
                    value={config?.[item.key] ?? item.defaultValue}
                    defaultValue={item.defaultValue}
                    onSave={(v) => handleSave(item.key, v)}
                    isSaving={mutation.isPending}
                    canEdit={canEdit}
                  />
                ))}
              </div>
            </div>
          ))}

          <AuthSection
            title="Grafana Authentication"
            keys={{
              type: "grafanaAuthType",
              user: "grafanaAuthUser",
              password: "grafanaAuthPassword",
              token: "grafanaAuthToken",
            }}
            config={config}
            canEdit={canEdit}
            onSave={handleSave}
            isSaving={mutation.isPending}
          />

          <AuthSection
            title="VictoriaMetrics Authentication"
            keys={{
              type: "vmAuthType",
              user: "vmAuthUser",
              password: "vmAuthPassword",
              token: "vmAuthToken",
            }}
            config={config}
            canEdit={canEdit}
            onSave={handleSave}
            isSaving={mutation.isPending}
          />

          {mutation.isError && (
            <p className="text-red-500 text-sm">
              Failed to save: {(mutation.error as Error).message}
            </p>
          )}

          <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
            <div className="px-4 py-3 bg-gray-50 dark:bg-gray-800/50 border-b border-gray-200 dark:border-gray-700">
              <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300">About</h2>
            </div>
            <div className="px-4 py-3 text-sm text-gray-500 dark:text-gray-400">
              <p>OODP UI Testing Platform v0.1.0</p>
              <p className="mt-1">
                Deterministic Playwright-based UI regression testing for Grafana dashboards
                with ML-assisted analysis and automated test generation.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Settings page shell with tabs. "General" is always available; "Auth Profiles"
 * and "Audit Log" are folded in here as admin-only tabs (they used to be
 * standalone routes). Each tab is a nested route rendered via <Outlet />.
 */
export default function Settings() {
  const userIsAdmin = isAdmin(useCurrentUser());

  const tabs = [
    { to: "/settings", label: "General", icon: SettingsIcon, end: true, show: true },
    {
      to: "/settings/auth-profiles",
      label: "Auth Profiles",
      icon: KeyRound,
      end: false,
      show: userIsAdmin,
    },
    {
      to: "/settings/audit",
      label: "Audit Log",
      icon: ScrollText,
      end: false,
      show: userIsAdmin,
    },
  ].filter((t) => t.show);

  return (
    <div>
      <div className="px-8 pt-8">
        <div className="flex items-center gap-3 mb-4">
          <SettingsIcon className="w-6 h-6 text-gray-700 dark:text-gray-300" />
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Settings</h1>
        </div>
        <nav className="flex gap-1 border-b border-gray-200 dark:border-gray-700">
          {tabs.map((t) => (
            <NavLink
              key={t.to}
              to={t.to}
              end={t.end}
              className={({ isActive }) =>
                `-mb-px inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                  isActive
                    ? "border-orange-500 text-orange-600 dark:text-orange-400"
                    : "border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 hover:border-gray-300 dark:hover:border-gray-600"
                }`
              }
            >
              <t.icon className="w-4 h-4" />
              {t.label}
            </NavLink>
          ))}
        </nav>
      </div>
      <Outlet />
    </div>
  );
}
