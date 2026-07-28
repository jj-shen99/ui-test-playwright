import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type AuthProfileInfo } from "../api";
import { useCurrentUser, isAdmin } from "../useCurrentUser";
import { KeyRound, Loader2, Plus, Trash2, ShieldAlert, Lock, Cookie } from "lucide-react";

type Kind = "basic" | "token" | "storage_state";

const KIND_META: Record<Kind, { label: string; icon: typeof Lock; hint: string }> = {
  basic: { label: "Username & Password", icon: Lock, hint: "Form-login credentials." },
  token: { label: "API Token", icon: KeyRound, hint: "Bearer / service-account token." },
  storage_state: {
    label: "Captured SSO Session",
    icon: Cookie,
    hint: "Playwright storageState JSON captured via `playwright codegen --save-storage`.",
  },
};

function CreateProfileForm({ onDone }: { onDone: () => void }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [kind, setKind] = useState<Kind>("basic");
  const [targetUrl, setTargetUrl] = useState("");
  const [username, setUsername] = useState("");
  const [secret, setSecret] = useState("");
  const [storageState, setStorageState] = useState("");

  const create = useMutation({
    mutationFn: () =>
      api.createAuthProfile({
        name: name.trim(),
        kind,
        targetUrl: targetUrl.trim() || undefined,
        username: kind === "basic" ? username.trim() : undefined,
        secret: kind === "storage_state" ? undefined : secret,
        storageState: kind === "storage_state" ? storageState : undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["auth-profiles"] });
      onDone();
    },
  });

  const canSubmit =
    name.trim().length > 0 &&
    (kind === "basic"
      ? username.trim() && secret
      : kind === "token"
        ? secret.trim()
        : storageState.trim());

  return (
    <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-4 space-y-3">
      <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300">New Auth Profile</h2>

      <div className="grid grid-cols-2 gap-3">
        <label className="text-xs text-gray-500 dark:text-gray-400 space-y-1">
          <span>Name</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="prod-grafana-admin"
            className="w-full px-2 py-1.5 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 rounded text-sm"
          />
        </label>
        <label className="text-xs text-gray-500 dark:text-gray-400 space-y-1">
          <span>Kind</span>
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as Kind)}
            className="w-full px-2 py-1.5 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 rounded text-sm"
          >
            {(Object.keys(KIND_META) as Kind[]).map((k) => (
              <option key={k} value={k}>
                {KIND_META[k].label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label className="text-xs text-gray-500 dark:text-gray-400 space-y-1 block">
        <span>Target URL (optional)</span>
        <input
          value={targetUrl}
          onChange={(e) => setTargetUrl(e.target.value)}
          placeholder="https://grafana.example.com"
          className="w-full px-2 py-1.5 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 rounded text-sm"
        />
      </label>

      {kind === "basic" && (
        <div className="grid grid-cols-2 gap-3">
          <label className="text-xs text-gray-500 dark:text-gray-400 space-y-1">
            <span>Username</span>
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="off"
              className="w-full px-2 py-1.5 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 rounded text-sm"
            />
          </label>
          <label className="text-xs text-gray-500 dark:text-gray-400 space-y-1">
            <span>Password</span>
            <input
              type="password"
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              autoComplete="new-password"
              className="w-full px-2 py-1.5 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 rounded text-sm"
            />
          </label>
        </div>
      )}

      {kind === "token" && (
        <label className="text-xs text-gray-500 dark:text-gray-400 space-y-1 block">
          <span>API Token</span>
          <input
            type="password"
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            autoComplete="new-password"
            className="w-full px-2 py-1.5 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 rounded text-sm"
          />
        </label>
      )}

      {kind === "storage_state" && (
        <label className="text-xs text-gray-500 dark:text-gray-400 space-y-1 block">
          <span>storageState JSON</span>
          <textarea
            value={storageState}
            onChange={(e) => setStorageState(e.target.value)}
            rows={5}
            placeholder='{"cookies":[…],"origins":[…]}'
            className="w-full px-2 py-1.5 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 rounded text-xs font-mono"
          />
          <span className="text-gray-400">{KIND_META.storage_state.hint}</span>
        </label>
      )}

      {create.isError && (
        <p className="text-red-500 text-xs">{(create.error as Error).message}</p>
      )}

      <div className="flex items-center gap-2">
        <button
          onClick={() => create.mutate()}
          disabled={!canSubmit || create.isPending}
          className="inline-flex items-center gap-1.5 text-sm bg-orange-500 hover:bg-orange-600 text-white rounded-md px-3 py-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {create.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
          Create
        </button>
        <button
          onClick={onDone}
          className="text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 px-3 py-1.5"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

function ProfileRow({ profile }: { profile: AuthProfileInfo }) {
  const queryClient = useQueryClient();
  const del = useMutation({
    mutationFn: () => api.deleteAuthProfile(profile.id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["auth-profiles"] }),
    onError: (err: unknown) =>
      alert(err instanceof Error ? err.message : "Failed to delete profile."),
  });

  const meta = KIND_META[profile.kind];
  const Icon = meta?.icon ?? KeyRound;

  return (
    <tr className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
      <td className="px-4 py-3 font-medium text-gray-800 dark:text-gray-200">{profile.name}</td>
      <td className="px-4 py-3">
        <span className="inline-flex items-center gap-1.5 text-xs text-gray-600 dark:text-gray-300">
          <Icon className="w-3.5 h-3.5" />
          {meta?.label ?? profile.kind}
        </span>
      </td>
      <td className="px-4 py-3 text-gray-500 dark:text-gray-400 font-mono text-xs truncate max-w-xs">
        {profile.targetUrl || "—"}
      </td>
      <td className="px-4 py-3 text-gray-500 dark:text-gray-400 text-xs">
        {profile.kind === "storage_state"
          ? profile.hasStorageState
            ? "session stored"
            : "—"
          : profile.hasSecret
            ? "secret stored"
            : "—"}
      </td>
      <td className="px-4 py-3 text-right">
        <button
          onClick={() => {
            if (window.confirm(`Delete auth profile "${profile.name}"?`)) del.mutate();
          }}
          disabled={del.isPending}
          className="inline-flex items-center gap-1 text-xs text-gray-400 hover:text-red-600 dark:hover:text-red-400 disabled:opacity-50"
          title="Delete profile"
        >
          {del.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
        </button>
      </td>
    </tr>
  );
}

export default function AuthProfiles() {
  const userIsAdmin = isAdmin(useCurrentUser());
  const [showForm, setShowForm] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["auth-profiles"],
    queryFn: api.getAuthProfiles,
    enabled: userIsAdmin,
  });

  if (!userIsAdmin) {
    return (
      <div className="p-8 max-w-3xl">
        <div className="flex items-center gap-3 text-gray-600 dark:text-gray-300">
          <ShieldAlert className="w-5 h-5 text-orange-500" />
          <p>You need administrator access to manage auth profiles.</p>
        </div>
      </div>
    );
  }

  const profiles = data?.profiles ?? [];

  return (
    <div className="p-8 max-w-5xl space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <KeyRound className="w-6 h-6 text-gray-700 dark:text-gray-300" />
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Auth Profiles</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Reusable, encrypted credentials and captured SSO sessions for scheduled runs.
            </p>
          </div>
        </div>
        {!showForm && (
          <button
            onClick={() => setShowForm(true)}
            className="inline-flex items-center gap-1.5 text-sm bg-orange-500 hover:bg-orange-600 text-white rounded-md px-3 py-2"
          >
            <Plus className="w-4 h-4" /> New Profile
          </button>
        )}
      </div>

      {showForm && <CreateProfileForm onDone={() => setShowForm(false)} />}

      {isLoading ? (
        <div className="flex items-center gap-2 text-gray-500">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading…
        </div>
      ) : profiles.length === 0 ? (
        <p className="text-gray-500 text-sm">No auth profiles yet. Create one to reuse across schedules.</p>
      ) : (
        <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-800/50 border-b border-gray-200 dark:border-gray-700">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-gray-600 dark:text-gray-400">Name</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600 dark:text-gray-400">Kind</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600 dark:text-gray-400">Target</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600 dark:text-gray-400">Secret</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
              {profiles.map((p) => (
                <ProfileRow key={p.id} profile={p} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
