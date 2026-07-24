"""Shared fixtures: an isolated temp SQLite DB per test, and a TestClient."""

import pytest

from app import db
from app.config import settings
from app import library


@pytest.fixture(autouse=True)
def temp_db(tmp_path, monkeypatch):
    """Point the cache at a fresh temp DB for every test and create the schema."""
    monkeypatch.setattr(settings, "db_path", str(tmp_path / "test.db"))
    # Tests create and mutate ROM dirs constantly — a cached listing would make them
    # order-dependent. The cache has its own dedicated test.
    monkeypatch.setattr(settings, "scan_cache_ttl", 0)
    library.invalidate_scan_cache()
    db.init_db()
    yield


@pytest.fixture
def client():
    """A FastAPI TestClient (its context runs the startup hook = init_db)."""
    from fastapi.testclient import TestClient

    from app.main import app

    with TestClient(app) as c:
        yield c
