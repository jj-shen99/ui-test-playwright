import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { api } from "../api";
import {
  type RunTargetConfig,
  defaultRunTargetConfig,
  TargetAuthFields,
} from "../components/RunConfigFields";
import {
  Wand2,
  FileCode2,
  ExternalLink,
  Loader2,
  AlertTriangle,
  CheckCircle,
  Upload,
  Sparkles,
  GitBranch,
  Tag,
} from "lucide-react";

type GenerateMode = "uid" | "json";
type TestType = "smoke" | "sanity" | "regression" | "e2e";

const TEST_TYPE_OPTIONS: { value: TestType; label: string; description: string }[] = [
  { value: "smoke", label: "Smoke", description: "Quick high-level checks that core panels render" },
  { value: "sanity", label: "Sanity", description: "Focused verification of specific dashboard features" },
  { value: "regression", label: "Regression", description: "Full coverage for catching regressions" },
  { value: "e2e", label: "E2E", description: "End-to-end user journey tests" },
];

export default function Generate() {
  const [mode, setMode] = useState<GenerateMode>("uid");
  const [dashboardUid, setDashboardUid] = useState("");
  const [dashboardJson, setDashboardJson] = useState("");
  const [useLlm, setUseLlm] = useState(false);
  const [testType, setTestType] = useState<TestType>("smoke");
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [target, setTarget] = useState<RunTargetConfig>(defaultRunTargetConfig);

  const patchTarget = (p: Partial<RunTargetConfig>) =>
    setTarget((t) => ({ ...t, ...p }));

  const { data: config } = useQuery({
    queryKey: ["config"],
    queryFn: api.getConfig,
  });

  const targetPayload = {
    targetUrl: target.targetUrl.trim() || undefined,
    authType: target.authType,
    authUsername: target.authUsername.trim() || undefined,
    authPassword: target.authPassword || undefined,
    authToken: target.authToken.trim() || undefined,
  };

  const mutation = useMutation({
    mutationFn: () => {
      if (mode === "uid") {
        return api.generate({ dashboardUid, useLlm, testType, ...targetPayload });
      } else {
        let parsed: unknown;
        try {
          parsed = JSON.parse(dashboardJson);
          setJsonError(null);
        } catch {
          throw new Error("Invalid JSON — check your dashboard JSON and try again.");
        }
        return api.generate({ dashboardJson: parsed, useLlm, testType });
      }
    },
  });

  const canSubmit =
    (mode === "uid" && dashboardUid.trim().length > 0) ||
    (mode === "json" && dashboardJson.trim().length > 0);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = reader.result as string;
      try {
        JSON.parse(text);
        setDashboardJson(text);
        setJsonError(null);
      } catch {
        setJsonError("Uploaded file is not valid JSON.");
      }
    };
    reader.readAsText(file);
  };

  return (
    <div className="p-8 max-w-4xl">
      <div className="flex items-center gap-3 mb-6">
        <Wand2 className="w-6 h-6 text-gray-700 dark:text-gray-300" />
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
          Generate Playwright Tests
        </h1>
      </div>

      <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
        Generate baseline Playwright specs from a Grafana dashboard. Tests are
        written into the external test repository and opened as a pull request
        for review.
      </p>

      {/* Target repo info */}
      {config && (
        <div className="mb-6 p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg flex items-center gap-3">
          <GitBranch className="w-4 h-4 text-blue-600 shrink-0" />
          <div className="text-sm">
            <span className="text-gray-600 dark:text-gray-400">Target repo: </span>
            <a
              href={config.testRepoUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-700 font-medium hover:underline"
            >
              {config.testRepoUrl.replace(/^https?:\/\/[^/]+\//, "")}
            </a>
            <span className="text-gray-400 dark:text-gray-500 ml-2">({config.testRepoBranch})</span>
          </div>
        </div>
      )}

      {/* Mode selector */}
      <div className="flex gap-2 mb-6">
        <button
          onClick={() => setMode("uid")}
          className={`px-4 py-2 text-sm rounded-lg border transition-colors ${
            mode === "uid"
              ? "bg-orange-50 dark:bg-orange-900/20 border-orange-300 dark:border-orange-700 text-orange-700 dark:text-orange-400 font-medium"
              : "bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
          }`}
        >
          By Dashboard UID
        </button>
        <button
          onClick={() => setMode("json")}
          className={`px-4 py-2 text-sm rounded-lg border transition-colors ${
            mode === "json"
              ? "bg-orange-50 dark:bg-orange-900/20 border-orange-300 dark:border-orange-700 text-orange-700 dark:text-orange-400 font-medium"
              : "bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
          }`}
        >
          Paste / Upload JSON
        </button>
      </div>

      {/* Input form */}
      <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-6 mb-6">
        {mode === "uid" ? (
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Dashboard UID
            </label>
            <input
              type="text"
              placeholder="e.g. PBFA97CFB590B2093"
              value={dashboardUid}
              onChange={(e) => setDashboardUid(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 rounded-md text-sm focus:ring-2 focus:ring-orange-300 focus:border-orange-400 outline-none"
            />
            <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">
              The UID from the Grafana dashboard URL or JSON model. The
              generation service will fetch the dashboard JSON via the Grafana
              API using the target &amp; authentication below.
            </p>

            {/* Remote application URL + authentication (used to fetch the dashboard) */}
            <div className="mt-4 pt-4 border-t border-gray-100 dark:border-gray-700">
              <TargetAuthFields config={target} onChange={patchTarget} />
              <p className="mt-2 text-xs text-gray-400 dark:text-gray-500">
                Leave the URL blank to use the configured local Grafana
                (<code className="bg-gray-100 dark:bg-gray-700 px-1 rounded">GRAFANA_URL</code>).
              </p>
            </div>
          </div>
        ) : (
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Dashboard JSON
            </label>
            <textarea
              placeholder='Paste the full Grafana dashboard JSON here (the "dashboard" object)...'
              value={dashboardJson}
              onChange={(e) => {
                setDashboardJson(e.target.value);
                setJsonError(null);
              }}
              rows={12}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 rounded-md text-sm font-mono focus:ring-2 focus:ring-orange-300 focus:border-orange-400 outline-none"
            />
            {jsonError && (
              <p className="mt-1 text-xs text-red-500">{jsonError}</p>
            )}
            <div className="mt-2 flex items-center gap-2">
              <label className="inline-flex items-center gap-1 px-3 py-1.5 text-xs bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 rounded-md cursor-pointer hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors">
                <Upload className="w-3 h-3" />
                Upload JSON file
                <input
                  type="file"
                  accept=".json"
                  onChange={handleFileUpload}
                  className="hidden"
                />
              </label>
              <span className="text-xs text-gray-400">
                Or drag & drop a dashboard JSON export
              </span>
            </div>
          </div>
        )}

        {/* Test type selector */}
        <div className="mt-4 pt-4 border-t border-gray-100 dark:border-gray-700">
          <div className="flex items-center gap-1.5 mb-2">
            <Tag className="w-4 h-4 text-gray-500 dark:text-gray-400" />
            <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
              Test Type
            </span>
          </div>
          <div className="flex gap-2 flex-wrap">
            {TEST_TYPE_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setTestType(opt.value)}
                className={`px-3 py-1.5 text-xs rounded-md border transition-colors ${
                  testType === opt.value
                    ? "bg-orange-50 dark:bg-orange-900/20 border-orange-300 dark:border-orange-700 text-orange-700 dark:text-orange-400 font-medium"
                    : "bg-white dark:bg-gray-700 border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-600"
                }`}
                title={opt.description}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <p className="mt-1.5 text-xs text-gray-400 dark:text-gray-500">
            {TEST_TYPE_OPTIONS.find((o) => o.value === testType)?.description}
          </p>
        </div>

        {/* LLM option */}
        <div className="mt-4 pt-4 border-t border-gray-100 dark:border-gray-700">
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={useLlm}
              onChange={(e) => setUseLlm(e.target.checked)}
              className="w-4 h-4 rounded border-gray-300 text-orange-500 focus:ring-orange-400"
            />
            <div className="flex items-center gap-1.5">
              <Sparkles className="w-4 h-4 text-purple-500" />
              <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                Enable LLM-assisted generation
              </span>
            </div>
          </label>
          <p className="ml-7 mt-1 text-xs text-gray-400 dark:text-gray-500">
            Uses Claude to propose journey / edge-case tests as{" "}
            <code className="bg-gray-100 dark:bg-gray-700 px-1 rounded">*.draft.spec.ts</code>{" "}
            files. These require human review before merging.
          </p>
        </div>
      </div>

      {/* Generate button */}
      <button
        onClick={() => mutation.mutate()}
        disabled={!canSubmit || mutation.isPending}
        className="flex items-center gap-2 px-6 py-2.5 bg-orange-500 text-white rounded-lg hover:bg-orange-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-medium"
      >
        {mutation.isPending ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin" />
            Generating...
          </>
        ) : (
          <>
            <Wand2 className="w-4 h-4" />
            Generate Tests
          </>
        )}
      </button>

      {/* Error state */}
      {mutation.isError && (
        <div className="mt-6 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-red-800">
              Generation failed
            </p>
            <p className="text-sm text-red-600 mt-1">
              {(mutation.error as Error).message}
            </p>
          </div>
        </div>
      )}

      {/* Success state */}
      {mutation.isSuccess && mutation.data && (
        <div className="mt-6 p-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg">
          <div className="flex items-center gap-2 mb-3">
            <CheckCircle className="w-5 h-5 text-green-600" />
            <span className="text-sm font-semibold text-green-800">
              Tests generated successfully!
            </span>
          </div>

          {/* Files generated */}
          <div className="mb-3">
            <p className="text-xs font-medium text-gray-600 mb-1.5">
              Files generated ({mutation.data.filesGenerated.length}):
            </p>
            <ul className="space-y-1">
              {mutation.data.filesGenerated.map((file) => (
                <li
                  key={file}
                  className="flex items-center gap-2 text-xs font-mono text-gray-700"
                >
                  <FileCode2 className="w-3.5 h-3.5 text-blue-500 shrink-0" />
                  {file}
                </li>
              ))}
            </ul>
          </div>

          {/* PR link */}
          {mutation.data.prUrl ? (
            <a
              href={mutation.data.prUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm bg-green-600 text-white rounded-md hover:bg-green-700 transition-colors"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              Open Pull Request
            </a>
          ) : (
            <p className="text-xs text-gray-500">
              PR was not created (no git remote configured or generation ran
              locally). Files are written to the tests directory.
            </p>
          )}
        </div>
      )}

      {/* How it works */}
      <div className="mt-8 p-4 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg">
        <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
          How it works
        </h3>
        <ol className="text-xs text-gray-500 dark:text-gray-400 space-y-1.5 list-decimal ml-4">
          <li>
            Provide a Grafana dashboard UID (fetched live via the Grafana API) or
            paste / upload the raw dashboard JSON.
          </li>
          <li>
            The parser extracts panels, queries, template variables, and data
            source references from the dashboard model.
          </li>
          <li>
            Baseline Playwright specs are generated from templates — each panel
            gets a "renders without error" and "series count" test; each variable
            gets a cascade test.
          </li>
          <li>
            Generated files are committed to{" "}
            <code className="bg-white dark:bg-gray-700 px-1 rounded">
              app_tests/generated/&lt;uid&gt;/
            </code>{" "}
            in the target repo using idempotent file names so re-running is safe.
          </li>
          <li>
            A git branch is created automatically, committed, and pushed to the
            configured test repository. A PR comparison URL is returned so you
            can review and merge.
          </li>
          <li>
            When LLM-assisted generation is enabled, Claude proposes additional
            journey and edge-case tests as{" "}
            <code className="bg-white dark:bg-gray-700 px-1 rounded">*.draft.spec.ts</code>{" "}
            files. These are intentionally marked as drafts and require human
            review before merging.
          </li>
        </ol>
      </div>
    </div>
  );
}
