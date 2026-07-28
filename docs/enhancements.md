# Enhancements & Roadmap

A prioritized list of proposed improvements for the Grafana UI Testing Platform.
Impact/Effort are rough T-shirt estimates (L = low, M = medium, H = high).

## Authentication & Targets

| # | Enhancement | Impact | Effort |
|---|-------------|--------|--------|
| 1 | ✅ **SSO session injection for remote runs.** Store a captured `storageState` (Playwright `--save-storage`) and have the orchestrator mount it into each cloned run dir, so SSO-protected instances (ServiceNow/Okta) can run unattended. | H | M |
| 2 | ✅ **Encrypted credential storage.** Persist target credentials/tokens encrypted at rest instead of passing per-trigger; support named auth profiles reusable across runs/schedules. | H | M |
| 3 | ✅ **Target origin vs. deep-link handling in the UI.** Auto-detect when a full dashboard URL is pasted and split origin (for auth) from path (for navigation); preview the resolved login/dashboard URLs. | M | L |
| 4 | ✅ **Auth pre-flight check.** A "Test connection" button on `/trigger` that verifies auth against the target before queueing a full run. | M | L |

## Test Management

| # | Enhancement | Impact | Effort |
|---|-------------|--------|--------|
| 5 | ✅ **Delete a single test, not the whole file.** Today removal is file-level; add safe single-`test()` excision or grouping by file in the UI. | M | H |
| 6 | ✅ **Git-backed test mutations.** Optionally `git rm`/commit on delete (and commit on upload) so changes propagate to scheduled/remote runs that clone fresh. | H | M |
| 7 | ✅ **Rename / move tests** with override + history migration. | L | M |
| 8 | ✅ **Normalize `test_id` to repo-relative paths** in `store-reporter.ts` so `/results` and the catalog show clean, matching IDs (currently absolute temp paths from the run clone). | M | L |

## Results & Insights

| # | Enhancement | Impact | Effort |
|---|-------------|--------|--------|
| 9 | ✅ **Inline artifact viewer.** Render Playwright traces, videos, and screenshots directly in `/results/:id` instead of raw object links. | H | M |
| 10 | ✅ **Flaky / quarantine badges** surfaced in the catalog and run views, wired to the ML `test_health` table. | M | M |
| 11 | ✅ **Trend dashboards** — pass rate, duration, and flakiness over time per test and per suite. | M | M |
| 12 | ✅ **Failure triage suggestions in-UI** — expose the ML triage endpoint output on the failure drill-down page. | M | M |

## Execution & Orchestration

| # | Enhancement | Impact | Effort |
|---|-------------|--------|--------|
| 13 | ✅ **Parallel sharding.** Split a run across multiple workers/shards and merge results for faster large suites. | H | M |
| 14 | ✅ **Automatic ret/quarantine integration.** Skip or soft-fail known-flaky tests based on `test_health`, with clear reporting. | M | M |
| 15 | ✅ **Per-run environment overrides in the UI** (viewport, timezone, template-variable values, time range). | M | M |
| 16 | ✅ **Live log streaming polish** — reconnect handling, log level filters, and per-step timing. | L | L |

## Security & Access Control

| # | Enhancement | Impact | Effort |
|---|-------------|--------|--------|
| 17 | ✅ **RBAC on destructive actions** (delete run, delete test, edit schedules) — restrict to admin roles. | H | L |
| 18 | ✅ **Secrets management** via env/secret store rather than plaintext config; redact secrets in logs. | H | M |
| 19 | ✅ **Audit log** of who triggered/deleted what. | M | M |

## Generation

| # | Enhancement | Impact | Effort |
|---|-------------|--------|--------|
| 20 | ✅ **Template-variable coverage generation** — auto-emit assertions for each dashboard variable/dropdown. | M | M |
| 21 | ✅ **Stable-selector preference** — generate `data-testid` based locators over Emotion class hashes. | M | L |
| 22 | ✅ **LLM edge-case expansion** guarded by a review/diff step before writing specs. | M | H |

## Developer Experience

| # | Enhancement | Impact | Effort |
|---|-------------|--------|--------|
| 23 | ✅ **One-command dev stack** (`npm run dev`) starting API, orchestrator, frontend, and infra with health checks. | M | L |
| 24 | ✅ **Watch mode by default** for API/orchestrator so route/code changes hot-reload. | L | L |
| 25 | ✅ **Seed/fixtures for local `/results`** so the UI has data without a full run. | L | L |

## Implemented

- **#3 Deep-link handling** — `frontend/src/targetUrl.ts` `describeTargetUrl()` splits a
  pasted URL into origin (auth/login) and path+query (navigation); the trigger/schedule
  form previews both and warns on malformed URLs.
- **#4 Auth pre-flight** — `POST /api/targets/preflight` (`services/api/routes/targets.ts`)
  checks `<origin>/api/health` reachability and, when credentials are supplied, verifies
  them against `<origin>/api/user` (SSO redirects are reported, not counted as success). A
  **Test connection** button surfaces the result in `TargetAuthFields`.
- **#8 Repo-relative `test_id`** — `store-reporter.ts` `makeTestId()` emits
  `app_tests/…/foo.spec.ts::title`, matching the on-disk catalog produced by
  `test-discovery.ts` (both relative to the repo/clone root).
- **#17 RBAC** — `services/api/routes/rbac.ts` `requireAdmin` gates destructive endpoints
  (delete run/app-test/schedule, create/update/delete user). The client asserts identity
  via the `x-user-id` header (`frontend/src/api.ts`), and the server resolves the role from
  the DB (source of truth). Admin-only controls are hidden in the UI for non-admins. Note:
  this is identity-by-header, not session tokens — see #1/#2/#18 for stronger auth.
- **#21 Stable selectors** — `tests/pages/grafana-dashboard.page.ts` prefers Grafana
  `data-testid` selectors (legend series, panel loading bar, dashboard) over Emotion
  `css-*` class hashes, with class-based fallbacks.
- **#1 SSO session injection** — `auth_profiles` rows of kind `storage_state` hold a captured
  Playwright `storageState` (encrypted). On a run, the orchestrator writes it into the cloned
  repo and sets `AUTH_STATE_PATH`/`AUTH_STATE_INJECTED`; `app_tests/fixtures/auth.setup.ts`
  reuses that session (Mode 0) instead of logging in.
- **#2 Encrypted credential storage** — `services/shared/crypto.ts` (AES-256-GCM, scrypt key
  from `APP_SECRET_KEY`) encrypts schedule secrets and auth-profile passwords/tokens at rest
  with a self-describing `enc:v1:` prefix and transparent legacy-plaintext migration. Named,
  reusable profiles live at `/api/auth-profiles` and the **Auth Profiles** admin page.
- **#9 Inline artifact viewer** — `services/shared/artifacts.ts` `classifyArtifact()` maps each
  artifact to a viewer (image/video/text/trace/download); `GET /api/artifacts/:id/url` returns a
  presigned URL, and `RunDetail` renders screenshots/videos inline with a download/trace path.
- **#18 Secrets management / redaction** — `services/shared/redact.ts` masks secret config keys
  in API responses (`redactConfig`/`maskSecret`) and scrubs literal secret values out of streamed
  run logs (`redactSecrets`). Secrets are never returned in clear by the config or profile APIs.
- **#19 Audit log** — `services/api/routes/audit.ts` `recordAudit()` records who triggered/deleted
  runs, changed schedules/users, and managed credentials, with actor identity from `x-user-id`.
  Admins review it at `GET /api/audit` and the **Audit Log** page.
- **#5 Delete a single test** — `test-discovery.ts` `findTestBlock()`/`removeTestByTitle()` excise
  one `test()` by title (string/comment-aware paren matching, with an integrity guard that refuses
  to rewrite unless exactly one test is removed). `DELETE /api/tests/single` (admin) removes the
  file when it becomes empty; the catalog exposes a per-test scissors button.
- **#10 Flaky / quarantine badges** — `GET /api/tests/health` returns a `testId → {flakinessScore,
  quarantined}` map; `testHealth.ts` `healthBadge()` classifies it and the `HealthBadge` component
  renders flaky/quarantine chips in the Test Catalog and Run Detail results.
- **#11 Trend dashboards** — `/api/insights/trends` adds a pass-rate-over-time series alongside the
  duration trend; the ML Insights page charts both plus rising flakiness.
- **#12 Failure triage in-UI** — the Failure Drill-Down page calls `/api/insights/triage` and renders
  nearest historical failures via `triage.ts` `normalizeTriage()` (handles ML and DB-fallback shapes).
- **#16 Live log streaming polish** — `logFormat.ts` (`filterLogs`/`formatElapsed`/`elapsedMs`) powers
  per-stream level filters, per-line elapsed timing, and a reconnecting/live status in the console panel.
- **#20 Template-variable coverage generation** — `templates.ts` `buildVariableCoverageTests()` emits
  per-variable assertions scaled to what each variable declares: dropdown visible + reflected in the
  URL always; an "All" option when `includeAll`; option-population when query/custom/multi; and a
  cascade check when the variable has dependencies. New page-object helpers (`openVariable`,
  `getVariableOptionCount`, `expectVariableHasAllOption`, `expectVariableInUrl`) back the generated code.
- **#7 Rename a test** — `test-discovery.ts` `renameTestInSource()` rewrites only the title literal
  (preserving quote style, escaping delimiters, with an integrity guard). `PATCH /api/tests/rename`
  (admin) migrates the type override and ML `test_health` row to the new testId; the catalog exposes a
  per-test pencil button.
- **#14 Auto quarantine integration** — `run-command.ts` `buildQuarantineArgs()` adds a Playwright
  `--grep-invert` that skips quarantined titles (explicitly-selected tests still run); the orchestrator
  logs exactly which tests were auto-skipped.
- **#15 Per-run environment overrides** — `run-command.ts` `buildRunEnvOverrides()` validates viewport /
  timezone / time-range inputs into `RUN_*` env vars; `app_tests/playwright.config.ts` applies viewport
  and `timezoneId`, and the Trigger page has a collapsible overrides panel (`runEnvOverrides.ts`
  `toEnvOverridesPayload`).
- **#23 One-command dev stack** — `scripts/dev.ts` (wired to `npm run dev`) starts the API, orchestrator,
  and frontend together with prefixed, color-coded output and coordinated shutdown, using only Node's
  `child_process` (no extra dependency).
- **#6 Git-backed test mutations** — `services/shared/git.ts` (`isGitBackedEnabled`, `buildCommitMessage`,
  `commitTestMutation`) commits — and optionally pushes (`GIT_BACKED_PUSH`) — every upload / delete / rename
  made through the tests API when `GIT_BACKED_TESTS` is set, so scheduled and remote runs that clone fresh
  pick up the change. It is best-effort: the on-disk change is already applied, so a git failure is logged,
  never thrown. Wired into all four mutation endpoints in `services/api/routes/tests.ts`.
- **#13 Parallel sharding** — `run-command.ts` (`resolveShardCount`, `buildShardPlan`, `mergeShardStatuses`)
  splits a run across N (≤ `MAX_SHARDS`) Playwright shards. The orchestrator spawns them in parallel; each
  shard runs a disjoint `--shard=i/N` slice under the same `RUN_ID`, so results merge implicitly in the DB,
  and the run passes only if every shard exits 0. Selectable on `/trigger` (Environment overrides → Parallel
  shards) and via the `shards` field on `POST /api/runs`.
- **#22 LLM edge-case expansion (review gate)** — `services/generation/review.ts` (`extractSpecCode`,
  `validateDraftSpec`, `computeLineDiff`, `reviewLlmDraft`) never writes an LLM draft straight into the
  suite: each draft is cleaned, validated (must be a real spec using the shared page object, no `.only`, no
  fixed sleeps), and diffed against any existing file. Non-blocking *warnings* (e.g. a time range pinned
  without the `SEED_*_EPOCH_MS` constants) are surfaced but never block approval. Valid drafts are only
  enabled with `generate --approve`; otherwise they are parked under `tests/.llm-review/` with a summary for
  a human to inspect.
- **#24 Watch mode by default** — `api:dev` and `orchestrator:dev` run under `tsx watch` (with
  `--clear-screen=false` so the combined `npm run dev` output isn't wiped on reload); the Vite frontend
  hot-reloads by default. Route/code changes reload without a manual restart.
- **#25 Seed fixtures for local `/results`** — `tests/fixtures/results-fixture.ts` `buildResultsFixture()`
  produces deterministic runs, per-test results, and `test_health` rows (including a flaky and a quarantined
  test); `scripts/seed-results.ts` (`npm run seed:results`) inserts them idempotently so the UI has data to
  render without executing a full run. `npm run seed:results -- --clear` removes the fixture rows,
  including the seeded `test_health` entries (so no test stays quarantined afterward).

## Suggested next steps (highest value, lowest effort first)

The roadmap items above are all implemented. Remaining ideas for future work:

1. Full unified-diff output (not just line counts) in the #22 review summary.
2. Cross-worker artifact merging / shard-level progress in the run detail view for #13.
3. A UI affordance to trigger `seed:results` (#25) and to toggle git-backed mode (#6).
