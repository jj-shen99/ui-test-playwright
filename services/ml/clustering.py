"""
Failure clustering (FR-21).

Embed failure signatures (error message + stack + failing selector)
and cluster them so many tests failing from one root cause collapse into one cluster.
"""

import re
from typing import Optional

import numpy as np
import pandas as pd
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.cluster import AgglomerativeClustering
from sqlalchemy import text
from .db import engine

MIN_FAILURES_FOR_CLUSTERING = 5
DISTANCE_THRESHOLD = 1.0


class FailureClusterer:
    def __init__(self):
        self.vectorizer = TfidfVectorizer(
            max_features=500,
            stop_words="english",
            ngram_range=(1, 2),
        )

    def analyze(self, run_id: Optional[str] = None) -> dict:
        """Run clustering on failure signatures and persist results."""
        with engine.connect() as conn:
            query = text("""
                SELECT tr.id, tr.test_id, tr.failure_signature, tr.run_id, tr.created_at
                FROM test_results tr
                WHERE tr.failure_signature IS NOT NULL
                ORDER BY tr.created_at DESC
                LIMIT 5000
            """)
            df = pd.read_sql(query, conn)

        if len(df) < MIN_FAILURES_FOR_CLUSTERING:
            return {"clusters": 0, "message": "Not enough failures to cluster"}

        # Normalize signatures
        df["normalized"] = df["failure_signature"].apply(self._normalize_signature)

        # Vectorize
        tfidf_matrix = self.vectorizer.fit_transform(df["normalized"])

        # Cluster
        clustering = AgglomerativeClustering(
            n_clusters=None,
            distance_threshold=DISTANCE_THRESHOLD,
            metric="cosine",
            linkage="average",
        )
        labels = clustering.fit_predict(tfidf_matrix.toarray())
        df["cluster_label"] = labels

        # Persist clusters
        self._persist_clusters(df)

        return {
            "clusters": int(clustering.n_clusters_),
            "failures_analyzed": len(df),
        }

    def get_clusters(self, run_id: Optional[str] = None) -> dict:
        """Return cluster information."""
        with engine.connect() as conn:
            result = conn.execute(
                text(
                    "SELECT id, representative, size, first_seen, last_seen FROM failure_clusters ORDER BY last_seen DESC LIMIT 50"
                )
            )
            clusters = [
                {
                    "id": str(r.id),
                    "representative": r.representative,
                    "size": r.size,
                    "first_seen": str(r.first_seen),
                    "last_seen": str(r.last_seen),
                }
                for r in result
            ]
        return {"clusters": clusters}

    def _normalize_signature(self, sig: str) -> str:
        """Normalize a failure signature for better clustering."""
        # Remove file paths
        sig = re.sub(r"(/[\w./]+)+", "<PATH>", sig)
        # Remove line numbers
        sig = re.sub(r":\d+:\d+", "", sig)
        # Remove hex addresses
        sig = re.sub(r"0x[0-9a-fA-F]+", "<ADDR>", sig)
        # Remove UUIDs
        sig = re.sub(
            r"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}",
            "<UUID>",
            sig,
        )
        return sig.strip()

    def _persist_clusters(self, df: pd.DataFrame):
        """Write cluster information to failure_clusters table."""
        with engine.begin() as conn:
            # Clear old clusters
            conn.execute(text("DELETE FROM failure_clusters"))

            for label in df["cluster_label"].unique():
                cluster_df = df[df["cluster_label"] == label]
                representative = cluster_df.iloc[0]["failure_signature"][:500]

                conn.execute(
                    text("""
                        INSERT INTO failure_clusters (id, representative, size, first_seen, last_seen)
                        VALUES (gen_random_uuid(), :rep, :size, :first, :last)
                    """),
                    {
                        "rep": representative,
                        "size": int(len(cluster_df)),
                        "first": cluster_df["created_at"].min(),
                        "last": cluster_df["created_at"].max(),
                    },
                )

            # Update cluster_id on test_results
            for _, row in df.iterrows():
                conn.execute(
                    text(
                        "UPDATE test_results SET cluster_id = :cluster_id WHERE id = :id"
                    ),
                    {"cluster_id": None, "id": str(row["id"])},
                )
