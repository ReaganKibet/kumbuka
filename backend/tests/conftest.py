import os
import tempfile

# Isolated database and AI off for every test run. Set TEST_DATABASE_URL to run against Postgres.
if os.getenv("TEST_DATABASE_URL"):
    os.environ["DATABASE_URL"] = os.environ["TEST_DATABASE_URL"]
else:
    _db = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
    os.environ["DATABASE_URL"] = f"sqlite:///{_db.name}"
os.environ["ANTHROPIC_API_KEY"] = ""
os.environ["SECRET_KEY"] = "test-secret-key-that-is-long-enough-for-hs256"
os.environ["ALLOW_REGISTRATION"] = "true"
os.environ.pop("RENDER", None)

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import text  # noqa: E402

from app.db import engine  # noqa: E402
from app.main import app  # noqa: E402
from app.security import login_ip_limiter, public_ip_limiter  # noqa: E402


@pytest.fixture(scope="session")
def api():
    if engine.dialect.name == "postgresql":
        with engine.begin() as conn:
            conn.execute(text("DROP SCHEMA public CASCADE; CREATE SCHEMA public;"))
    with TestClient(app) as c:
        yield c


@pytest.fixture(autouse=True)
def _reset_limiters():
    login_ip_limiter.reset()
    public_ip_limiter.reset()
