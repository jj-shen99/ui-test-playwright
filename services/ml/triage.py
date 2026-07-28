"""
Triage suggestion (FR-22).

For a new failure, retrieve nearest historical failures and surface likely cause/owner.
Uses TF-IDF nearest-neighbor lookup over historical failure embeddings.
"""

import pandas as pd
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity
from sqlalchemy import text
from .db import engine


class TriageSuggester:
    def __init__(self):
        self.vectorizer = TfidfVectorizer(
            max_features=500,
            stop_words="english",
            ngram_range=(1, 2),
        )
        self._fitted = False
        self._history_df = None
        self._tfidf_matrix = None

    def _load_history(self):
        """Load historical failures and fit the vectorizer."""
        with engine.connect() as conn:
            self._history_df = pd.read_sql(
                text("""
                    SELECT tr.id, tr.test_id, tr.failure_signature, tr.created_at,
                           r.commit_sha
                    FROM test_results tr
                    JOIN runs r ON tr.run_id = r.id
                    WHERE tr.failure_signature IS NOT NULL
                    ORDER BY tr.created_at DESC
                    LIMIT 2000
                """),
                conn,
            )

        if len(self._history_df) > 0:
            self._tfidf_matrix = self.vectorizer.fit_transform(
                self._history_df["failure_signature"]
            )
            self._fitted = True

    def suggest(self, failure_id: str) -> dict:
        """Find similar historical failures for triage."""
        # Get the target failure
        with engine.connect() as conn:
            result = conn.execute(
                text(
                    "SELECT id, test_id, failure_signature FROM test_results WHERE id = :id"
                ),
                {"id": failure_id},
            )
            row = result.fetchone()

        if not row or not row.failure_signature:
            return {"suggestion": None, "message": "Failure not found or no signature"}

        # Reload history if needed
        if not self._fitted:
            self._load_history()

        if not self._fitted or self._history_df is None:
            return {
                "suggestion": None,
                "message": "No historical data available for triage",
            }

        # Transform the target and find nearest neighbors
        target_vec = self.vectorizer.transform([row.failure_signature])
        similarities = cosine_similarity(target_vec, self._tfidf_matrix)[0]

        # Get top 5 most similar (excluding self)
        top_indices = similarities.argsort()[::-1]
        suggestions = []
        for idx in top_indices[:6]:
            hist_row = self._history_df.iloc[idx]
            if str(hist_row["id"]) == failure_id:
                continue
            suggestions.append(
                {
                    "test_id": hist_row["test_id"],
                    "failure_signature": hist_row["failure_signature"][:200],
                    "similarity": float(similarities[idx]),
                    "commit_sha": hist_row["commit_sha"],
                    "created_at": str(hist_row["created_at"]),
                }
            )
            if len(suggestions) >= 5:
                break

        return {
            "target_test_id": row.test_id,
            "similar_failures": suggestions,
        }
