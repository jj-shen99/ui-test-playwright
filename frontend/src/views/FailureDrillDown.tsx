import { useParams, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import { normalizeTriage } from "../triage";
import {
  ArrowLeft,
  FileVideo,
  Image,
  FileText,
  Loader2,
  AlertTriangle,
  ExternalLink,
  Lightbulb,
} from "lucide-react";

export default function FailureDrillDown() {
  const { resultId } = useParams<{ resultId: string }>();

  const { data: artifactsData, isLoading, error } = useQuery({
    queryKey: ["artifacts", resultId],
    queryFn: () => api.getArtifacts(resultId!),
    enabled: !!resultId,
  });

  if (isLoading)
    return (
      <div className="p-8 flex items-center gap-2 text-gray-500">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading artifacts...
      </div>
    );

  if (error)
    return (
      <div className="p-8 text-red-500 flex items-center gap-2">
        <AlertTriangle className="w-4 h-4" /> Error loading artifacts
      </div>
    );

  const artifacts = artifactsData?.artifacts || [];

  const traces = artifacts.filter((a) => a.kind === "trace");
  const videos = artifacts.filter((a) => a.kind === "video");
  const screenshots = artifacts.filter((a) => a.kind === "screenshot");
  const logs = artifacts.filter((a) => a.kind === "log");

  return (
    <div className="p-8 max-w-5xl">
      <Link
        to=".."
        className="inline-flex items-center gap-1 text-sm text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 mb-4"
      >
        <ArrowLeft className="w-4 h-4" /> Back to run
      </Link>

      <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-6">
        Failure Drill-Down
      </h1>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
        Result ID: <code className="bg-gray-100 dark:bg-gray-700 dark:text-gray-300 px-1 rounded">{resultId}</code>
      </p>

      {resultId && <TriagePanel failureId={resultId} />}

      {artifacts.length === 0 && (
        <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-8 text-center text-gray-400">
          No artifacts found for this test result.
        </div>
      )}

      {/* Traces — embed Playwright trace viewer */}
      {traces.length > 0 && (
        <section className="mb-8">
          <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-200 mb-3 flex items-center gap-2">
            <FileText className="w-5 h-5 text-blue-500" />
            Playwright Traces
          </h2>
          <div className="space-y-3">
            {traces.map((trace) => (
              <div
                key={trace.id}
                className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden"
              >
                <div className="p-3 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between">
                  <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                    Trace
                  </span>
                  <a
                    href={`https://trace.playwright.dev/?trace=${encodeURIComponent(trace.objectUri)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800"
                  >
                    Open in Playwright Trace Viewer
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
                <iframe
                  src={`https://trace.playwright.dev/?trace=${encodeURIComponent(trace.objectUri)}`}
                  className="w-full h-[500px] border-0"
                  title="Playwright Trace Viewer"
                />
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Videos */}
      {videos.length > 0 && (
        <section className="mb-8">
          <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-200 mb-3 flex items-center gap-2">
            <FileVideo className="w-5 h-5 text-purple-500" />
            Videos
          </h2>
          <div className="grid grid-cols-1 gap-4">
            {videos.map((video) => (
              <div
                key={video.id}
                className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden"
              >
                <div className="p-3 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between">
                  <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                    Test Recording
                  </span>
                  <a
                    href={video.objectUri}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-blue-600 hover:text-blue-800 inline-flex items-center gap-1"
                  >
                    Download <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
                <video
                  src={video.objectUri}
                  controls
                  className="w-full max-h-[400px] bg-black"
                >
                  Your browser does not support the video tag.
                </video>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Screenshots */}
      {screenshots.length > 0 && (
        <section className="mb-8">
          <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-200 mb-3 flex items-center gap-2">
            <Image className="w-5 h-5 text-green-500" />
            Screenshots
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {screenshots.map((screenshot) => (
              <div
                key={screenshot.id}
                className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden"
              >
                <a
                  href={screenshot.objectUri}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <img
                    src={screenshot.objectUri}
                    alt="Failure screenshot"
                    className="w-full h-auto"
                  />
                </a>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Logs */}
      {logs.length > 0 && (
        <section className="mb-8">
          <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-200 mb-3 flex items-center gap-2">
            <FileText className="w-5 h-5 text-yellow-500" />
            Console / Network Logs
          </h2>
          <div className="space-y-3">
            {logs.map((log) => (
              <div
                key={log.id}
                className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-3"
              >
                <a
                  href={log.objectUri}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-blue-600 hover:text-blue-800 inline-flex items-center gap-1"
                >
                  View log file <ExternalLink className="w-3 h-3" />
                </a>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

/**
 * ML-assisted triage (#12): surfaces the nearest historical failures for this
 * result so an engineer can spot a recurring cause/owner. Handles both the ML
 * service response and the DB-fallback shape via `normalizeTriage`.
 */
function TriagePanel({ failureId }: { failureId: string }) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["triage", failureId],
    queryFn: () => api.getTriage(failureId),
  });

  const { similar, message } = normalizeTriage(data);

  return (
    <section className="mb-8">
      <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-200 mb-3 flex items-center gap-2">
        <Lightbulb className="w-5 h-5 text-amber-500" />
        Triage Suggestions
      </h2>
      <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-4">
        {isLoading ? (
          <div className="flex items-center gap-2 text-sm text-gray-500">
            <Loader2 className="w-4 h-4 animate-spin" /> Finding similar failures…
          </div>
        ) : isError ? (
          <p className="text-sm text-red-500">Could not load triage suggestions.</p>
        ) : similar.length === 0 ? (
          <p className="text-sm text-gray-400">
            {message ?? "No similar historical failures found."}
          </p>
        ) : (
          <>
            {message && (
              <p className="text-xs text-gray-400 mb-3">{message}</p>
            )}
            <ul className="space-y-2">
              {similar.map((s, i) => (
                <li
                  key={`${s.testId}-${i}`}
                  className="p-3 rounded border border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/40"
                >
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <Link
                      to={`/tests/${encodeURIComponent(s.testId)}`}
                      className="font-mono text-xs text-blue-600 hover:underline truncate"
                    >
                      {s.testId}
                    </Link>
                    {s.similarity != null && (
                      <span className="text-xs font-medium text-amber-600 shrink-0">
                        {(s.similarity * 100).toFixed(0)}% match
                      </span>
                    )}
                    {s.similarity == null && s.count != null && (
                      <span className="text-xs font-medium text-gray-500 shrink-0">
                        {s.count}× seen
                      </span>
                    )}
                  </div>
                  {s.signature && (
                    <p className="text-xs text-gray-600 dark:text-gray-400 truncate">
                      {s.signature}
                    </p>
                  )}
                  {s.commitSha && (
                    <p className="text-[10px] text-gray-400 mt-1 font-mono">
                      {s.commitSha.slice(0, 12)}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </section>
  );
}
