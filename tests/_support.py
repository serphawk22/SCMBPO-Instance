"""
Shared fixtures for tests that call main.py endpoints.

`main` is imported once, with database.engine already pointed at an in-memory SQLite engine, and each
test re-points every module-level engine reference at that same engine and overrides main.get_session.
TestClient is used without its context manager, so the startup hook (pollers, keep-alive thread,
account provisioning, migrations) never runs.
"""
import importlib
import sys
import warnings
from unittest import mock

from sqlalchemy.exc import SAWarning
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine

import database

ENGINE = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)

# Modules that bind `engine` (or `default_engine`) at import time.
_ENGINE_HOLDERS = ("database", "main", "routers.email_tracking", "routers.inbox", "routers.followups",
                   "routers.follow_ups", "routers.email_campaigns", "modules.inbox_sync", "modules.api_tracker", "routers.leaderboard",
                   "routers.scm2_features")


def load_main():
    if "main" not in sys.modules:
        database.engine = ENGINE
    return importlib.import_module("main")


def reset_db(engine=ENGINE):
    with warnings.catch_warnings():
        # Existing models have a leads <-> client_profiles <-> projects FK cycle SQLite can't sort.
        warnings.simplefilter("ignore", SAWarning)
        SQLModel.metadata.drop_all(engine)
    SQLModel.metadata.create_all(engine)


def use_engine(testcase, engine=ENGINE):
    """Point every module-level engine reference at `engine` for the duration of one test."""
    for name in _ENGINE_HOLDERS:
        mod = sys.modules.get(name)
        if mod is None:
            continue
        for attr in ("engine", "default_engine"):
            if hasattr(mod, attr):
                p = mock.patch.object(mod, attr, engine)
                p.start()
                testcase.addCleanup(p.stop)


def main_client(testcase, engine=ENGINE):
    """TestClient for the real main.app (real middleware, tenant filter and routes), no lifespan."""
    from fastapi.testclient import TestClient

    main = load_main()
    use_engine(testcase, engine)
    main._USER_TENANT_CACHE.clear()  # the middleware caches user -> (role, tenant) for 60 s

    def _session():
        with Session(engine) as s:
            yield s

    main.app.dependency_overrides[main.get_session] = _session
    testcase.addCleanup(main.app.dependency_overrides.pop, main.get_session, None)
    return TestClient(main.app, raise_server_exceptions=False)
