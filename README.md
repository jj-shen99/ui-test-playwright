# Grafana UI Testing Platform

Automated UI functional testing platform for Grafana deployments backed by VictoriaMetrics.

## Architecture

- **Deterministic environment** — Docker Compose stack with Grafana, VictoriaMetrics, Postgres, Redis, and MinIO
- **Tests-as-code** — Playwright specs committed to git, run against absolute time ranges for full determinism
- **Generated tests** — Dashboard JSON → Playwright spec emitter, with optional LLM-assisted generation
- **Results store** — PostgreSQL + S3-compatible object storage for runs, results, and artifacts
- **ML insights** — Flakiness detection, failure clustering, and triage suggestions (Python/FastAPI)
- **Frontend** — React + TailwindCSS dashboard with results view, run trigger, test catalog, and ML insights

## Quick Start

```bash
# 1. Install dependencies
npm install
cd frontend && npm install && cd ..

# 2. Copy env config
cp .env.example .env

# 3. Start the deterministic environment
npm run env:up

# 4. Wait for services and seed data
npm run env:wait
npm run env:seed

# 5. Run DB migrations
npm run db:migrate

# 6. Run smoke tests
npm run test:smoke
```

## Services

| Service | Command | Port |
|---------|---------|------|
| **Grafana** (SUT) | `npm run env:up` | 3000 |
| **VictoriaMetrics** | `npm run env:up` | 8428 |
| **API** (Fastify) | `npm run api:dev` | 6199 |
| **Frontend** (Vite) | `npm run frontend:dev` | 6200 |
| **Orchestrator** (BullMQ) | `npm run orchestrator:dev` | — |
| **ML Service** (FastAPI) | `uvicorn services.ml.main:app` | 8000 |

To start the API, orchestrator, and frontend together with one command (prefixed,
color-coded output; Ctrl-C stops all), run `npm run dev`. Bring the infra up first
with `npm run env:up` so those services can connect to Postgres/Redis.

## Project Structure

```
├── db/                     # Database schema, migrations, connection
├── env/                    # Docker Compose + Grafana provisioning
│   ├── docker-compose.yml
│   └── provisioning/       # Datasources, dashboards
├── frontend/               # React + Vite + TailwindCSS
│   └── src/
│       ├── views/          # RunsDashboard, RunDetail, TestCatalog, etc.
│       └── api.ts          # API client
├── services/
│   ├── api/                # Fastify API server + routes
│   ├── generation/         # Dashboard parser + spec emitter + LLM
│   ├── ml/                 # Python ML analysis service
│   ├── orchestrator/       # BullMQ run execution worker
│   └── shared/             # S3 client, shared utilities
├── tests/
│   ├── fixtures/           # Seed data, auth setup, reporter
│   ├── handwritten/        # Hand-crafted Playwright specs
│   ├── generated/          # Auto-generated specs (from generator)
│   └── pages/              # Page object models
├── .github/workflows/      # CI: PR smoke + nightly full suite
├── playwright.config.ts
├── package.json
└── tsconfig.json
```

## Test Generation

Generate Playwright specs from a Grafana dashboard:

```bash
# From a running Grafana instance
npm run generate -- --uid sample-infra

# From a JSON file
npm run generate -- --file path/to/dashboard.json

# With LLM-assisted edge-case generation (requires ANTHROPIC_API_KEY)
npm run generate -- --uid sample-infra --llm

# LLM drafts are validated + diffed and parked in tests/.llm-review/ for review;
# add --approve to enable valid drafts directly into the active suite (#22)
npm run generate -- --uid sample-infra --llm --approve
```

Runs can be split across parallel Playwright shards for faster large suites (#13):
choose a shard count under **Environment overrides → Parallel shards** on `/trigger`,
or pass `shards` to `POST /api/runs`. Each shard runs a disjoint slice under the same
run; the run passes only if every shard passes.

## Local Results Fixture

Seed the results store with deterministic sample runs, results, and flaky/quarantine
health rows so the UI (`/results`, catalog, insights) has data without a full run (#25):

```bash
npm run seed:results             # ~8 sample runs
npm run seed:results -- --runs 20
npm run seed:results -- --clear  # remove fixture rows
```

## Environment Variables

See `.env.example` for all configuration options. Key variables:

- `GRAFANA_URL` — Grafana instance URL (default: `http://localhost:3000`)
- `DATABASE_URL` — PostgreSQL connection string
- `S3_ENDPOINT` — MinIO/S3 endpoint for artifact storage
- `ANTHROPIC_API_KEY` — Required only for LLM-assisted generation
- `APP_SECRET_KEY` — Encryption key for secrets at rest (schedule/auth-profile credentials).
  **Required in any non-local environment**; if unset, an insecure dev key is used and a
  warning is logged.
- `GIT_BACKED_TESTS` — When truthy (`1`/`true`), test uploads/deletes/renames made through the
  API are committed to the repo so scheduled/remote runs that clone fresh stay in sync (#6).
  Uploaded specs (normally gitignored under `app_tests/uploaded/`) are force-added so they also
  propagate.
- `GIT_BACKED_PUSH` — When truthy, also `git push` after each git-backed commit.
- `AUTH_STATE_PATH` / `AUTH_STATE_INJECTED` — Set by the orchestrator when an auth profile's
  captured SSO `storageState` is mounted into a run (see Auth Profiles below).

## Access Control

Destructive and administrative endpoints require an **admin** role. The frontend
identifies the caller with an `x-user-id` header (derived from the logged-in user);
the API resolves that id to a role in the database and enforces admin on:

- `DELETE /api/runs/:id`, `DELETE /api/tests/app-tests`, `DELETE /api/tests/single`, `DELETE /api/schedules/:id`
- `PATCH /api/tests/rename`
- `POST /api/users`, `PUT /api/users/:id`, `DELETE /api/users/:id`
- `POST /api/auth-profiles`, `DELETE /api/auth-profiles/:id`

Non-admin users don't see the corresponding UI controls. This is identity-by-header,
not session-token auth — see `docs/enhancements.md` for details.

### Auth profiles & encrypted credentials

Reusable, **encrypted** credentials and captured SSO sessions are managed on the admin
**Auth Profiles** page (`/auth-profiles`, `/api/auth-profiles`). Three kinds are supported:

- `basic` — username + password
- `token` — API token
- `storage_state` — a captured Playwright `storageState` JSON for SSO-protected targets

Secrets are encrypted at rest with AES-256-GCM (`APP_SECRET_KEY`); the API never returns
secret material, only whether it is set. For `storage_state` profiles the orchestrator writes
the session into each cloned run dir so SSO instances run unattended without a login step.

### Audit log

Sensitive actions (runs triggered/deleted, schedule/user changes, credential management) are
recorded with the actor's identity and shown on the admin **Audit Log** page (`/audit`,
`GET /api/audit`). Secret values are redacted from streamed run logs and masked in config responses.

### Target pre-flight

`POST /api/targets/preflight` verifies a target before a full run is queued:

```jsonc
// request
{ "targetUrl": "https://grafana.example.com", "authType": "basic",
  "authUsername": "admin", "authPassword": "…" }
// response
{ "reachable": true, "authenticated": true, "status": 200, "message": "…" }
```

It checks `<origin>/api/health` for reachability and `<origin>/api/user` for auth.
The **Test connection** button on the trigger/schedule form calls this endpoint.

## CI/CD

- **PR Smoke** (`.github/workflows/pr-smoke.yml`) — Runs `@smoke` tests on every PR
- **Nightly** (`.github/workflows/nightly.yml`) — Full suite with Grafana version matrix
