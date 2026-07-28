import { useEffect, useRef, useState } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import { useCurrentUser, isAdmin } from "../useCurrentUser";
import {
  CheckCircle,
  XCircle,
  SkipForward,
  AlertTriangle,
  ArrowLeft,
  Loader2,
  FileText,
  Terminal,
  Trash2,
  Image as ImageIcon,
  Video as VideoIcon,
  Download,
  X,
} from "lucide-react";
import type { Artifact, ArtifactViewer } from "../api";
import HealthBadge from "../components/HealthBadge";
import {
  LOG_LEVELS,
  type LogLevel,
  normalizeLevel,
  formatElapsed,
  elapsedMs,
  filterLogs,
} from "../logFormat";

const ACTIVE_STATUSES = ["queued", "running"];

const statusConfig: Record<
  string,
  { icon: React.ReactNode; bg: string; text: string }
> = {
  passed: {
    icon: <CheckCircle className="w-4 h-4" />,
    bg: "bg-green-100",
    text: "text-green-700",
  },
  failed: {
    icon: <XCircle className="w-4 h-4" />,
    bg: "bg-red-100",
    text: "text-red-700",
  },
  skipped: {
    icon: <SkipForward className="w-4 h-4" />,
    bg: "bg-gray-100",
    text: "text-gray-600",
  },
  flaky: {
    icon: <AlertTriangle className="w-4 h-4" />,
    bg: "bg-yellow-100",
    text: "text-yellow-700",
  },
};

export default function RunDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const userIsAdmin = isAdmin(useCurrentUser());

  const deleteRun = useMutation({
    mutationFn: () => api.deleteRun(id!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["runs"] });
      navigate("/");
    },
    onError: (err: unknown) => {
      alert(err instanceof Error ? err.message : "Failed to delete run.");
    },
  });

  const handleDelete = () => {
    if (window.confirm("Delete this run and all of its results? This cannot be undone.")) {
      deleteRun.mutate();
    }
  };

  const { data: runData, isLoading: runLoading } = useQuery({
    queryKey: ["run", id],
    queryFn: () => api.getRun(id!),
    enabled: !!id,
    refetchInterval: (query) =>
      ACTIVE_STATUSES.includes(query.state.data?.run.status ?? "") ? 3000 : false,
  });

  const runStatus = runData?.run.status ?? "";
  const isActive = ACTIVE_STATUSES.includes(runStatus);

  const { data: resultsData } = useQuery({
    queryKey: ["run-results", id],
    queryFn: () => api.getRunResults(id!),
    enabled: !!id,
    refetchInterval: () => (isActive ? 5000 : false),
  });

  const { data: healthData } = useQuery({
    queryKey: ["test-health"],
    queryFn: () => api.getTestHealth(),
  });
  const health = healthData?.health ?? {};

  if (runLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
      </div>
    );
  }

  const run = runData?.run;
  const stats = runData?.stats;
  const results = resultsData?.results ?? [];

  if (!run) return <div className="p-6">Run not found.</div>;

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <Link
        to="/"
        className="text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 flex items-center gap-1 mb-4"
      >
        <ArrowLeft className="w-3 h-3" /> Back to runs
      </Link>

      <div className="flex items-center gap-4 mb-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Run Detail</h1>
        <span
          className={`text-xs font-medium px-2.5 py-1 rounded-full ${
            run.status === "passed"
              ? "bg-green-100 text-green-800"
              : run.status === "failed"
                ? "bg-red-100 text-red-800"
                : "bg-gray-100 text-gray-600"
          }`}
        >
          {run.status}
        </span>
        {userIsAdmin && (
        <button
          onClick={handleDelete}
          disabled={isActive || deleteRun.isPending}
          title={
            isActive
              ? "Cannot delete a run that is queued or running"
              : "Delete run"
          }
          className="ml-auto inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-red-600 dark:text-gray-400 dark:hover:text-red-400 border border-gray-200 dark:border-gray-700 rounded-md px-3 py-1.5 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {deleteRun.isPending ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Trash2 className="w-4 h-4" />
          )}
          Delete
        </button>
        )}
      </div>

      {/* Run metadata */}
      <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4 mb-6 shadow-sm grid grid-cols-2 md:grid-cols-4 gap-4">
        <div>
          <p className="text-xs text-gray-500 dark:text-gray-400">Commit</p>
          <code className="text-sm dark:text-gray-200">{run.commitSha.slice(0, 12)}</code>
        </div>
        <div>
          <p className="text-xs text-gray-500 dark:text-gray-400">Grafana</p>
          <p className="text-sm dark:text-gray-200">{run.grafanaVersion}</p>
        </div>
        <div>
          <p className="text-xs text-gray-500 dark:text-gray-400">Trigger</p>
          <p className="text-sm dark:text-gray-200">{run.triggerSource}</p>
        </div>
        <div>
          <p className="text-xs text-gray-500 dark:text-gray-400">Selector</p>
          <p className="text-sm dark:text-gray-200">{run.selector}</p>
        </div>
      </div>

      {/* Live console logs */}
      <ConsoleLogs runId={id!} active={isActive} status={run.status} />

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-5 gap-3 mb-6">
          {[
            { label: "Total", value: stats.total, color: "text-gray-900" },
            { label: "Passed", value: stats.passed, color: "text-green-600" },
            { label: "Failed", value: stats.failed, color: "text-red-600" },
            {
              label: "Skipped",
              value: stats.skipped,
              color: "text-gray-500",
            },
            {
              label: "Flaky",
              value: stats.flaky,
              color: "text-yellow-600",
            },
          ].map((s) => (
            <div
              key={s.label}
              className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-3 shadow-sm text-center"
            >
              <p className="text-xs text-gray-500 dark:text-gray-400">{s.label}</p>
              <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
            </div>
          ))}
        </div>
      )}

      {/* Test results table */}
      <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 dark:bg-gray-800/50 border-b border-gray-200 dark:border-gray-700">
            <tr>
              <th className="text-left px-4 py-3 font-medium text-gray-600 dark:text-gray-400">
                Status
              </th>
              <th className="text-left px-4 py-3 font-medium text-gray-600 dark:text-gray-400">
                Test
              </th>
              <th className="text-left px-4 py-3 font-medium text-gray-600 dark:text-gray-400">
                Duration
              </th>
              <th className="text-left px-4 py-3 font-medium text-gray-600 dark:text-gray-400">
                Retries
              </th>
              <th className="text-left px-4 py-3 font-medium text-gray-600 dark:text-gray-400">
                Artifacts
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
            {results.map((r) => {
              const cfg = statusConfig[r.status] || statusConfig.failed;
              return (
                <tr key={r.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex items-center gap-1.5 text-xs font-medium px-2 py-0.5 rounded-full ${cfg.bg} ${cfg.text}`}
                    >
                      {cfg.icon}
                      {r.status}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center gap-2">
                      <Link
                        to={`/tests/${encodeURIComponent(r.testId)}`}
                        className="text-blue-600 hover:underline text-xs font-mono"
                      >
                        {r.testId}
                      </Link>
                      <HealthBadge health={health[r.testId]} />
                    </span>
                    {r.failureSignature && (
                      <p className="text-xs text-red-500 mt-1 max-w-lg truncate">
                        {r.failureSignature}
                      </p>
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-500 dark:text-gray-400">
                    {r.durationMs ? `${(r.durationMs / 1000).toFixed(1)}s` : "—"}
                  </td>
                  <td className="px-4 py-3 text-gray-500 dark:text-gray-400">{r.retryCount}</td>
                  <td className="px-4 py-3">
                    {r.status === "failed" && (
                      <ArtifactLinks resultId={r.id} />
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

interface LogLine {
  seq: number;
  stream: string;
  message: string;
  createdAt: string;
}

const LEVEL_META: Record<LogLevel, { label: string; color: string }> = {
  stdout: { label: "stdout", color: "text-gray-300" },
  stderr: { label: "stderr", color: "text-red-400" },
  system: { label: "system", color: "text-cyan-400" },
};

function ConsoleLogs({
  runId,
  active,
  status,
}: {
  runId: string;
  active: boolean;
  status: string;
}) {
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [autoScroll, setAutoScroll] = useState(true);
  const [showTimestamps, setShowTimestamps] = useState(true);
  const [levels, setLevels] = useState<Set<LogLevel>>(
    () => new Set(LOG_LEVELS)
  );
  // 'live' while polling ok, 'reconnecting' after a failed poll, 'idle' otherwise.
  const [connection, setConnection] = useState<"live" | "reconnecting" | "idle">(
    active ? "live" : "idle"
  );
  const lastSeqRef = useRef(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Reset when navigating between runs.
  useEffect(() => {
    setLogs([]);
    lastSeqRef.current = 0;
  }, [runId]);

  useEffect(() => {
    let cancelled = false;

    async function poll() {
      try {
        const res = await api.getRunLogs(runId, lastSeqRef.current);
        if (cancelled) return;
        if (res.logs.length > 0) {
          lastSeqRef.current = res.lastSeq;
          setLogs((prev) => [...prev, ...res.logs]);
        }
        setConnection(active ? "live" : "idle");
      } catch {
        // Surface a reconnecting state; the next tick retries automatically.
        if (!cancelled && active) setConnection("reconnecting");
      }
    }

    // Always fetch once (covers finished runs too), then poll while active.
    poll();
    if (!active) return;
    const interval = setInterval(poll, 2000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [runId, active]);

  // Auto-scroll to the newest line unless the user scrolled up.
  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs, autoScroll]);

  const baseline = logs[0]?.createdAt;
  const visibleLogs = filterLogs(logs, levels);

  const toggleLevel = (level: LogLevel) =>
    setLevels((prev) => {
      const next = new Set(prev);
      if (next.has(level)) next.delete(level);
      else next.add(level);
      return next;
    });

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 shadow-sm mb-6 overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2 border-b border-gray-200 dark:border-gray-700 gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <Terminal className="w-4 h-4 text-gray-500 dark:text-gray-400" />
          <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Console</span>
          {active && connection === "reconnecting" ? (
            <span className="inline-flex items-center gap-1 text-xs text-amber-500" title="Lost contact with the API — retrying">
              <Loader2 className="w-3.5 h-3.5 animate-spin" /> Reconnecting…
            </span>
          ) : active ? (
            <span className="inline-flex items-center gap-1 text-xs text-orange-500">
              <Loader2 className="w-3.5 h-3.5 animate-spin" /> Live
            </span>
          ) : null}
        </div>
        <div className="flex items-center gap-3">
          {/* Stream level filters */}
          <div className="flex items-center gap-2">
            {LOG_LEVELS.map((level) => (
              <label
                key={level}
                className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400 cursor-pointer"
              >
                <input
                  type="checkbox"
                  checked={levels.has(level)}
                  onChange={() => toggleLevel(level)}
                  className="accent-orange-500"
                />
                <span className={LEVEL_META[level].color}>{LEVEL_META[level].label}</span>
              </label>
            ))}
          </div>
          <label className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400 cursor-pointer">
            <input
              type="checkbox"
              checked={showTimestamps}
              onChange={(e) => setShowTimestamps(e.target.checked)}
              className="accent-orange-500"
            />
            Timing
          </label>
          <label className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400 cursor-pointer">
            <input
              type="checkbox"
              checked={autoScroll}
              onChange={(e) => setAutoScroll(e.target.checked)}
              className="accent-orange-500"
            />
            Auto-scroll
          </label>
        </div>
      </div>
      <div
        ref={scrollRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
          setAutoScroll(atBottom);
        }}
        className="bg-gray-950 text-gray-300 font-mono text-xs p-3 h-72 overflow-auto"
      >
        {logs.length === 0 ? (
          <p className="text-gray-500">
            {status === "queued"
              ? "Waiting for a worker to pick up this run… If it stays queued, the orchestrator worker may not be running (npm run orchestrator:dev)."
              : active
                ? "Waiting for output…"
                : "No console output was recorded for this run."}
          </p>
        ) : visibleLogs.length === 0 ? (
          <p className="text-gray-500">All streams are filtered out — enable a level above.</p>
        ) : (
          visibleLogs.map((l) => (
            <div key={l.seq} className="flex gap-2">
              {showTimestamps && (
                <span className="text-gray-600 shrink-0 select-none tabular-nums">
                  {formatElapsed(elapsedMs(l.createdAt, baseline)).padStart(6, " ")}
                </span>
              )}
              <span className={`whitespace-pre-wrap break-all ${LEVEL_META[normalizeLevel(l.stream)].color}`}>
                {l.message}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function viewerIcon(viewer: ArtifactViewer | undefined) {
  switch (viewer) {
    case "image":
      return <ImageIcon className="w-3 h-3" />;
    case "video":
      return <VideoIcon className="w-3 h-3" />;
    case "trace":
    case "download":
      return <Download className="w-3 h-3" />;
    default:
      return <FileText className="w-3 h-3" />;
  }
}

function ArtifactLinks({ resultId }: { resultId: string }) {
  const { data } = useQuery({
    queryKey: ["artifacts", resultId],
    queryFn: () => api.getArtifacts(resultId),
  });
  const [active, setActive] = useState<Artifact | null>(null);

  const artifacts = data?.artifacts ?? [];
  if (artifacts.length === 0) return <span className="text-gray-300">—</span>;

  return (
    <>
      <div className="flex flex-wrap gap-2">
        {artifacts.map((a) => (
          <button
            key={a.id}
            onClick={() => setActive(a)}
            className="inline-flex items-center gap-1 text-xs text-blue-600 hover:underline cursor-pointer"
            title={`View ${a.kind}`}
          >
            {viewerIcon(a.viewer)}
            {a.kind}
          </button>
        ))}
      </div>
      {active && (
        <ArtifactViewerModal artifact={active} onClose={() => setActive(null)} />
      )}
    </>
  );
}

function ArtifactViewerModal({
  artifact,
  onClose,
}: {
  artifact: Artifact;
  onClose: () => void;
}) {
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["artifact-url", artifact.id],
    queryFn: () => api.getArtifactUrl(artifact.id),
  });

  const viewer = data?.viewer ?? artifact.viewer;
  const url = data?.url;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-2 border-b border-gray-200 dark:border-gray-700">
          <span className="text-sm font-medium text-gray-700 dark:text-gray-200 flex items-center gap-2">
            {viewerIcon(viewer)}
            {artifact.kind}
          </span>
          <button
            onClick={onClose}
            className="p-1 text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
            title="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-4 overflow-auto bg-gray-50 dark:bg-gray-900 flex-1">
          {isLoading ? (
            <div className="flex items-center gap-2 text-gray-500">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading artifact…
            </div>
          ) : isError || !url ? (
            <p className="text-red-500 text-sm">
              Failed to load artifact
              {isError ? `: ${(error as Error).message}` : "."}
            </p>
          ) : viewer === "image" ? (
            <img src={url} alt={artifact.kind} className="max-w-full mx-auto" />
          ) : viewer === "video" ? (
            <video src={url} controls className="max-w-full mx-auto" />
          ) : (
            <div className="text-center py-8">
              <p className="text-sm text-gray-600 dark:text-gray-300 mb-3">
                {viewer === "trace"
                  ? "Playwright trace files open in the Playwright Trace Viewer."
                  : "This artifact can be downloaded."}
              </p>
              <a
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                download
                className="inline-flex items-center gap-1.5 text-sm bg-orange-500 hover:bg-orange-600 text-white rounded-md px-3 py-2"
              >
                <Download className="w-4 h-4" /> Download {artifact.kind}
              </a>
              {viewer === "trace" && (
                <p className="text-xs text-gray-400 mt-3">
                  Then run: <code>npx playwright show-trace &lt;file&gt;.zip</code>
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
