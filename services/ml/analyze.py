"""
ML Analysis Job — periodic write-back (Data flow #6 from architecture).
Reads from the results store, computes flakiness scores, runs clustering,
and writes insights back to Postgres (test_health, failure_clusters).

Run as: python -m services.ml.analyze
Or schedule via cron / systemd timer.
"""

import os
import sys
from datetime import datetime, timezone

import psycopg2
import psycopg2.extras
import numpy as np


DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql://grafana_test:grafana_test@localhost:5432/grafana_ui_testing",
)

# Flakiness threshold: at/above this score, auto-quarantine the test.
# Keep in sync with services/ml/flakiness.py and frontend/src/testHealth.ts.
QUARANTINE_THRESHOLD = float(os.getenv("QUARANTINE_THRESHOLD", "0.15"))

# Rolling window: number of recent runs to consider.
ROLLING_WINDOW = int(os.getenv("FLAKINESS_WINDOW", "200"))


def get_connection():
    return psycopg2.connect(DATABASE_URL)


def compute_flakiness_scores(conn):
    """
    FR-19: A test that both passes and fails on the same commit SHA is flaky.
    Compute per-test flakiness score over a rolling window.
    """
    print("[Flakiness] Computing scores...")

    with conn.cursor(cursor_factory=psycopg2.extras.DictCursor) as cur:
        # Get all tests with results in recent runs
        cur.execute("""
            WITH recent_runs AS (
                SELECT id, commit_sha
                FROM runs
                ORDER BY created_at DESC
                LIMIT %s
            ),
            test_results_window AS (
                SELECT tr.test_id, tr.status, r.commit_sha
                FROM test_results tr
                JOIN recent_runs r ON r.id = tr.run_id
            ),
            flaky_analysis AS (
                SELECT
                    test_id,
                    commit_sha,
                    COUNT(DISTINCT status) FILTER (WHERE status IN ('passed', 'failed')) as distinct_outcomes,
                    COUNT(*) FILTER (WHERE status = 'flaky') as flaky_outcomes,
                    COUNT(*) as total_runs
                FROM test_results_window
                GROUP BY test_id, commit_sha
            ),
            scores AS (
                SELECT
                    test_id,
                    -- Flakiness = proportion of (test, commit) pairs that either
                    -- mixed pass/fail or produced a retried-then-passed ('flaky') result.
                    COALESCE(
                        SUM(CASE WHEN distinct_outcomes > 1 OR flaky_outcomes > 0 THEN 1 ELSE 0 END)::float
                        / NULLIF(COUNT(*), 0),
                        0
                    ) as flakiness_score
                FROM flaky_analysis
                GROUP BY test_id
            )
            SELECT test_id, flakiness_score FROM scores
        """, (ROLLING_WINDOW,))

        scores = cur.fetchall()

    updated = 0
    quarantined = 0

    with conn.cursor() as cur:
        for row in scores:
            test_id = row["test_id"]
            score = row["flakiness_score"]
            should_quarantine = score >= QUARANTINE_THRESHOLD

            # Upsert into test_health (FR-20: auto-quarantine above threshold)
            cur.execute("""
                INSERT INTO test_health (test_id, flakiness_score, quarantined, updated_at)
                VALUES (%s, %s, %s, NOW())
                ON CONFLICT (test_id)
                DO UPDATE SET
                    flakiness_score = EXCLUDED.flakiness_score,
                    quarantined = EXCLUDED.quarantined,
                    updated_at = NOW()
            """, (test_id, score, should_quarantine))

            updated += 1
            if should_quarantine:
                quarantined += 1

    conn.commit()
    print(f"[Flakiness] Updated {updated} tests, quarantined {quarantined}")
    return updated, quarantined


def run_failure_clustering(conn):
    """
    FR-21: Cluster failures by signature similarity.
    Groups failures with identical normalized signatures and writes clusters.
    """
    print("[Clustering] Running failure clustering...")

    with conn.cursor(cursor_factory=psycopg2.extras.DictCursor) as cur:
        # Get failure signatures from recent results
        cur.execute("""
            SELECT
                failure_signature,
                COUNT(*) as size,
                MIN(created_at) as first_seen,
                MAX(created_at) as last_seen
            FROM test_results
            WHERE failure_signature IS NOT NULL
                AND failure_signature != ''
            GROUP BY failure_signature
            HAVING COUNT(*) >= 2
            ORDER BY COUNT(*) DESC
        """)
        clusters_raw = cur.fetchall()

    # Clear old clusters and write new ones
    with conn.cursor() as cur:
        cur.execute("DELETE FROM failure_clusters")

        cluster_count = 0
        for row in clusters_raw:
            cur.execute("""
                INSERT INTO failure_clusters (id, representative, size, first_seen, last_seen)
                VALUES (gen_random_uuid(), %s, %s, %s, %s)
            """, (row["failure_signature"], row["size"], row["first_seen"], row["last_seen"]))
            cluster_count += 1

        # Update cluster_id on test_results for traceability
        cur.execute("""
            UPDATE test_results tr
            SET cluster_id = fc.id
            FROM failure_clusters fc
            WHERE tr.failure_signature = fc.representative
                AND tr.failure_signature IS NOT NULL
        """)

    conn.commit()
    print(f"[Clustering] Created {cluster_count} clusters")
    return cluster_count


def run_analysis():
    """Main entry point: run all analysis steps."""
    print(f"=== ML Analysis Job started at {datetime.now(timezone.utc).isoformat()} ===")

    conn = get_connection()
    try:
        updated, quarantined = compute_flakiness_scores(conn)
        cluster_count = run_failure_clustering(conn)

        print(f"=== Analysis complete: {updated} scores updated, "
              f"{quarantined} quarantined, {cluster_count} clusters ===")
    finally:
        conn.close()


if __name__ == "__main__":
    run_analysis()
