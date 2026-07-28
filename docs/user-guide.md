# User Guide

## Getting Started

### Prerequisites

- **Node.js** >= 20
- **Docker** and **Docker Compose**
- **Python 3.10+** (for ML service, optional)

### Installation

```bash
# Clone the repository
git clone https://code.devsnc.com/jianjun-shen/grafana-ui-testing.git
cd grafana-ui-testing

# Install dependencies
npm install
cd frontend && npm install && cd ..

# Copy environment config
cp .env.example .env
```

### Starting the Platform

```bash
# 1. Start infrastructure (Grafana, VictoriaMetrics, PostgreSQL, Redis, MinIO)
npm run env:up

# 2. Wait for all services to be healthy
npm run env:wait

# 3. Seed test data into VictoriaMetrics and Grafana
npm run env:seed

# 4. Run database migrations
npm run db:migrate

# 5. Start the API server (port 6199)
npm run api:dev

# 6. Start the frontend dev server (port 6200)
npm run frontend:dev
```

Open **http://localhost:6200** in your browser.

### Stopping the Platform

```bash
# Stop infrastructure containers
npm run env:down

# Stop the API and frontend with Ctrl+C in their terminals
```

---

## Authentication

### Creating an Account

1. Open the app and you will be redirected to the **Sign In** page.
2. Click **Create an account** to reach the registration form.
3. Fill in your **Name**, **Email**, and **Password**.
   - Password requirements: minimum 8 characters, at least one uppercase letter, one lowercase letter, and one number.
4. Click **Create Account**. You will be redirected to Sign In after success.

### Signing In

1. Enter your **Email** and **Password**.
2. Click **Sign In**.
3. You will land on the Dashboard.

### Resetting Your Password

1. On the Sign In page, click **Forgot password?**
2. Enter your **Email**, **New Password**, and **Confirm New Password**.
3. Click **Reset Password**.

### Logging Out

Click the **logout icon** (↗) next to your name in the bottom-left corner of the sidebar.

---

## Dashboard

The home page shows an overview of all test runs with:
- Run status (queued, running, passed, failed, error)
- Trigger source (manual, PR, nightly)
- Grafana version tested
- Start/finish timestamps

Click any run to see its detailed results.

---

## Triggering a Test Run

1. Navigate to **Trigger Run** in the sidebar.
2. Select a **Test Selector**:
   - **All Tests** — run the full suite
   - **By Test Type** — Smoke, Sanity, Regression, or E2E
   - **Individual Tests** — pick a specific test from the catalog
3. (Optional) Expand **Advanced Options** to change the **Grafana Version**.
4. Click **Start Run**.
5. You will be redirected to the run detail page to monitor progress.

---

## Test Catalog

Navigate to **Test Catalog** to browse all known tests. It has two groupings:

- **App Tests** — the real specs discovered on disk under `app_tests/` (grouped by
  test case, one per spec file). This is the source of truth for what can run.
- **History** — an aggregate view of tests that have *actually executed*, built
  from run history (run count, average duration, last status). Unlike App Tests,
  it only lists tests that have run at least once.

For each test you can see:
- **Test ID** — stable identifier (file::title)
- **Last status** — passed, failed, flaky, skipped
- **Run count** — how many times it has been executed
- **Average duration**
- **Test type** — smoke, sanity, regression, e2e

Click a test to view its **history** — a timeline of all past results.

---

## Generating Tests

The platform can auto-generate Playwright test specs from Grafana dashboards.

### From a Dashboard UID

1. Navigate to **Generate** in the sidebar.
2. Select the **Dashboard UID** tab.
3. Enter the dashboard UID (e.g., `sample-infra`).
4. Choose a **Test Type** (Smoke, Sanity, Regression, E2E).
5. (Optional) Enable **LLM-Assisted Generation** for edge-case coverage (requires `ANTHROPIC_API_KEY`).
6. Click **Generate Tests**.

### From a JSON File

1. Select the **JSON Upload** tab.
2. Paste dashboard JSON or upload a `.json` file.
3. Choose a test type and click **Generate Tests**.

### From the CLI

```bash
# From a running Grafana instance
npm run generate -- --uid sample-infra

# From a JSON file
npm run generate -- --file path/to/dashboard.json

# With LLM assistance
npm run generate -- --uid sample-infra --llm
```

Generated specs are written to `tests/generated/`.

---

## Results & Failure Drill-Down

### Results Page

Navigate to **Results** to see all test results across runs. Each result shows:
- Test ID, status, duration, retry count
- Failure signature (for failed tests)

### Failure Drill-Down

Click a failed result to open the **Failure Drill-Down** page, which shows:
- Full failure message and stack trace
- Associated artifacts (screenshots, videos, traces)
- Cluster information (if ML has grouped similar failures)

---

## ML Insights

Navigate to **ML Insights** for AI-powered analysis:

### What "flaky" means

A single test result is marked **flaky** when Playwright had to **retry** it and it
eventually **passed** (i.e. it failed at least once, then passed on a retry within the
same run). This is the yellow `flaky` badge you see in Test History and Results.

Each test contributes **exactly one** stored result per run — its final outcome. Even
though Playwright reports every retry attempt, intermediate attempts are collapsed, so a
retried-then-passed test is recorded once as `flaky` (never as a separate `failed` row),
and failure artifacts are captured only for tests that ultimately failed.

The ML pipeline additionally computes a per-test **flakiness score** (0–100%) over a
rolling window of recent runs. A `(test, commit)` pair counts as flaky when it either
produced **both a pass and a fail** on the same commit across runs, **or** produced a
retried-then-passed (`flaky`) result. The score is the fraction of that test's recent
commits that were flaky.

### Quarantine List

When a test's flakiness score reaches **15%** (`QUARANTINE_THRESHOLD`) it is
automatically **quarantined**. Quarantined tests are still tracked and reported, but the
orchestrator skips them during normal runs (via a Playwright `--grep-invert`) so their
noise doesn't block CI — you can still run them explicitly by selecting them directly.
The percentage next to each entry is the current flakiness score.

### Failure Clusters

Similar failures grouped together by their error signatures. Helps identify systemic issues vs. isolated bugs.

---

## Schedules

Navigate to **Schedules** to set up automated test runs.

1. Click **Create Schedule**.
2. Fill in:
   - **Name** — descriptive name (e.g., "Nightly Full Suite")
   - **Cron Expression** — standard cron format (e.g., `0 2 * * *` for 2 AM daily)
   - **Selector** — which tests to run (all, smoke, etc.)
   - **Grafana Version** — target version
3. Click **Create**.

Schedules can be **enabled/disabled** and **deleted** from the list.

---

## Settings

Navigate to **Settings** to view and edit application configuration:

| Setting              | Default                                                                       | Purpose                      |
|----------------------|-------------------------------------------------------------------------------|------------------------------|
| Test Repo URL        | `https://code.devsnc.com/jianjun-shen/oodp_grafana_playwright_tests`          | Git repo with test specs     |
| Test Repo Branch     | `main`                                                                        | Branch to use                |
| API Endpoint         | `http://localhost:6199`                                                       | API server URL               |
| Grafana URL          | `http://localhost:3000`                                                       | Grafana instance URL         |
| VictoriaMetrics URL  | `http://localhost:8428`                                                       | VictoriaMetrics URL          |

Click the **edit icon** on any row to modify a value. Changes are persisted to the database.

---

## User Management (Admin Only)

Admins can access **Users** in the sidebar to manage accounts.

### Adding a User

1. Click **Add User**.
2. Fill in **Name**, **Email**, **Password**, and **Role** (user or admin).
3. Click **Create**.

### Editing a User

1. Click the **pencil icon** on a user row.
2. Modify the **Name** or **Role** inline.
3. Click the **checkmark** to save or **X** to cancel.

### Resetting a User's Password

Click the **key icon** on a user row and enter the new password in the prompt.

### Deactivating a User

Click the **trash icon** on a user row and confirm.

---

## Dark Mode

Toggle between light and dark themes using the **sun/moon icon** in the bottom-left corner of the sidebar. Your preference is saved in the browser.

---

## Running Tests Manually

```bash
# Run all tests
npm test

# Run smoke tests only
npm run test:smoke

# Run tests in headed mode (visible browser)
npm run test:headed

# Debug tests interactively
npm run test:debug

# View the HTML test report
npm run test:report
```

---

## Environment Variables

See `.env.example` for all options. Key variables:

| Variable            | Default                    | Description                           |
|---------------------|----------------------------|---------------------------------------|
| `GRAFANA_URL`       | `http://localhost:3000`    | Grafana instance URL                  |
| `DATABASE_URL`      | *(see .env.example)*       | PostgreSQL connection string          |
| `S3_ENDPOINT`       | `http://localhost:9000`    | MinIO/S3 endpoint for artifacts       |
| `REDIS_URL`         | `redis://localhost:6379`   | Redis URL for BullMQ job queue        |
| `API_PORT`          | `6199`                     | API server port                       |
| `ANTHROPIC_API_KEY` | *(none)*                   | Required only for LLM generation      |

---

## Troubleshooting

### Services won't start

```bash
# Check Docker containers
docker compose -f env/docker-compose.yml ps

# View container logs
docker compose -f env/docker-compose.yml logs grafana
```

### Database migration errors

```bash
# Re-run migrations
npm run db:migrate
```

### Tests fail to connect to Grafana

1. Verify Grafana is running: `curl http://localhost:3000/api/health`
2. Check `GRAFANA_URL` in `.env`
3. Ensure data is seeded: `npm run env:seed`

### Frontend shows blank page

1. Clear browser `localStorage` (may have stale auth data)
2. Restart the frontend dev server: `npm run frontend:dev`
