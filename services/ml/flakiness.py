"""
Flakiness detection (FR-19) and auto-quarantine (FR-20).

A test that both passes and fails on the same commit SHA is flaky.
Maintains a per-test flakiness score over a rolling window.
"""

import pandas as pd
from sqlalchemy import text
from .db import engine

ROLLING_WINDOW = 200  # Last N runs to consider
# Quarantine at/above this score. Keep in sync with services/ml/analyze.py
# and frontend/src/testHealth.ts.
QUARANTINE_THRESHOLD = 0.15


class FlakinessDetector:
    def analyze(self) -> dict:
        """Run flakiness analysis and update test_health table."""
        with engine.connect() as conn:
            # Get test results grouped by (test_id, commit_sha)
            df = pd.read_sql(
                text("""
                    SELECT tr.test_id, r.commit_sha, tr.status
                    FROM test_results tr
                    JOIN runs r ON tr.run_id = r.id
                    ORDER BY tr.created_at DESC
                    LIMIT :limit
                """),
                conn,
                params={"limit": ROLLING_WINDOW * 50},
            )

        if df.empty:
            return {"analyzed": 0, "quarantined": 0}

        # A (test, commit) is flaky if it mixed pass/fail, or produced a
        # retried-then-passed ('flaky') result.
        def is_flaky(statuses: set) -> bool:
            return ("passed" in statuses and "failed" in statuses) or "flaky" in statuses

        grouped = df.groupby(["test_id", "commit_sha"])["status"].apply(set)
        flaky_entries = grouped[grouped.apply(is_flaky)]

        # Calculate per-test flakiness score
        test_ids = df["test_id"].unique()
        scores = {}
        for test_id in test_ids:
            test_commits = grouped.loc[test_id] if test_id in grouped.index.get_level_values(0) else pd.Series(dtype=object)
            if len(test_commits) == 0:
                scores[test_id] = 0.0
                continue
            flaky_count = sum(1 for s in test_commits if is_flaky(s))
            scores[test_id] = flaky_count / len(test_commits)

        # Update test_health table
        quarantined_count = 0
        with engine.begin() as conn:
            for test_id, score in scores.items():
                quarantined = score >= QUARANTINE_THRESHOLD
                if quarantined:
                    quarantined_count += 1

                conn.execute(
                    text("""
                        INSERT INTO test_health (test_id, flakiness_score, quarantined, updated_at)
                        VALUES (:test_id, :score, :quarantined, NOW())
                        ON CONFLICT (test_id) DO UPDATE SET
                            flakiness_score = :score,
                            quarantined = :quarantined,
                            updated_at = NOW()
                    """),
                    {
                        "test_id": test_id,
                        "score": score,
                        "quarantined": quarantined,
                    },
                )

        return {
            "analyzed": len(scores),
            "quarantined": quarantined_count,
        }

    def get_quarantine_list(self) -> dict:
        """Return currently quarantined tests."""
        with engine.connect() as conn:
            result = conn.execute(
                text(
                    "SELECT test_id, flakiness_score, updated_at FROM test_health WHERE quarantined = true ORDER BY flakiness_score DESC"
                )
            )
            rows = [
                {
                    "test_id": r.test_id,
                    "flakiness_score": r.flakiness_score,
                    "updated_at": str(r.updated_at),
                }
                for r in result
            ]
        return {"quarantined": rows}
