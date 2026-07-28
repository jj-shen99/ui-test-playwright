"""Database connection for the ML service."""

import os
from sqlalchemy import create_engine
from dotenv import load_dotenv

load_dotenv()

DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql://grafana_test:grafana_test@localhost:5432/grafana_ui_testing",
)


def get_db_url() -> str:
    return DATABASE_URL


engine = create_engine(DATABASE_URL)
