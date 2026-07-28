"""
ML Analysis Service (§8.4)
FastAPI service for flakiness detection, failure clustering, and triage.
Endpoints: GET /quarantine, GET /clusters, GET /triage, POST /analyze
"""

import os
from contextlib import asynccontextmanager
from dotenv import load_dotenv
from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware

from .flakiness import FlakinessDetector
from .clustering import FailureClusterer
from .triage import TriageSuggester
from .db import get_db_url, engine

load_dotenv()


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Initialize ML models on startup."""
    app.state.flakiness = FlakinessDetector()
    app.state.clusterer = FailureClusterer()
    app.state.triage = TriageSuggester()
    yield


app = FastAPI(
    title="Grafana UI Testing — ML Analysis Service",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health():
    return {"status": "ok"}


@app.get("/quarantine")
async def get_quarantine():
    """Return the list of quarantined tests (FR-20)."""
    detector: FlakinessDetector = app.state.flakiness
    return detector.get_quarantine_list()


@app.get("/clusters")
async def get_clusters(run_id: str = Query(None)):
    """Return failure clusters, optionally filtered by run (FR-21)."""
    clusterer: FailureClusterer = app.state.clusterer
    return clusterer.get_clusters(run_id)


@app.get("/triage")
async def get_triage(failure_id: str = Query(...)):
    """Return triage suggestion for a failure (FR-22)."""
    suggester: TriageSuggester = app.state.triage
    return suggester.suggest(failure_id)


@app.post("/analyze")
async def trigger_analysis():
    """Trigger a full analysis pass: flakiness scoring, clustering, triage index."""
    detector: FlakinessDetector = app.state.flakiness
    clusterer: FailureClusterer = app.state.clusterer

    flakiness_result = detector.analyze()
    cluster_result = clusterer.analyze()

    return {
        "flakiness": flakiness_result,
        "clustering": cluster_result,
    }
