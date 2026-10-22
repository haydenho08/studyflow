import os

# Must be set before the app (and its cached settings) is imported.
os.environ["BCRYPT_ROUNDS"] = "4"  # minimum cost: hashing is the slowest part of the suite
os.environ.setdefault("JWT_SECRET_KEY", "test-secret-key-that-is-at-least-32-chars")

from collections.abc import Callable, Iterator

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import make_url, text
from sqlalchemy.orm import Session, sessionmaker

import app.models  # noqa: F401
from app.config import get_settings
from app.db import Base, get_db, make_engine
from app.main import app

TEST_DB_URL = get_settings().test_database_url

# The suite drops every table. Refuse to point it at anything but a test database.
assert make_url(TEST_DB_URL).database.endswith("_test"), (
    f"TEST_DATABASE_URL must name a *_test database, got {TEST_DB_URL!r}"
)

engine = make_engine(TEST_DB_URL)
TestingSessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)

AuthHeaders = dict[str, str]


@pytest.fixture(scope="session", autouse=True)
def _schema() -> Iterator[None]:
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    yield
    Base.metadata.drop_all(engine)
    engine.dispose()


@pytest.fixture(autouse=True)
def _clean_tables() -> Iterator[None]:
    """Each test starts with empty tables, so tests can't depend on each other's data."""
    yield
    tables = ", ".join(t.name for t in Base.metadata.sorted_tables)
    with engine.begin() as conn:
        conn.execute(text(f"TRUNCATE {tables} RESTART IDENTITY CASCADE"))


@pytest.fixture
def db() -> Iterator[Session]:
    """Direct database access, for asserting on what the API actually stored."""
    with TestingSessionLocal() as session:
        yield session


@pytest.fixture
def client() -> Iterator[TestClient]:
    def override_get_db() -> Iterator[Session]:
        with TestingSessionLocal() as session:
            yield session

    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()


@pytest.fixture
def make_user(client: TestClient) -> Callable[..., AuthHeaders]:
    """Register a user, log in, and return their Authorization header."""

    def _make_user(email: str, password: str = "correct-horse-battery") -> AuthHeaders:
        response = client.post("/api/auth/register", json={"email": email, "password": password})
        assert response.status_code == 201, response.text
        response = client.post("/api/auth/login", data={"username": email, "password": password})
        assert response.status_code == 200, response.text
        return {"Authorization": f"Bearer {response.json()['access_token']}"}

    return _make_user


@pytest.fixture
def alice(make_user: Callable[..., AuthHeaders]) -> AuthHeaders:
    return make_user("alice@example.com")


@pytest.fixture
def bob(make_user: Callable[..., AuthHeaders]) -> AuthHeaders:
    return make_user("bob@example.com")


@pytest.fixture
def make_course(client: TestClient) -> Callable[..., dict]:
    def _make_course(headers: AuthHeaders, code: str = "EECS 1012", **fields: str) -> dict:
        body = {"name": "Intro to Computer Science", "code": code, **fields}
        response = client.post("/api/courses", json=body, headers=headers)
        assert response.status_code == 201, response.text
        return response.json()

    return _make_course


@pytest.fixture
def make_assignment(client: TestClient) -> Callable[..., dict]:
    def _make_assignment(headers: AuthHeaders, course_id: int, **fields: str) -> dict:
        body = {
            "course_id": course_id,
            "title": "Lab 1",
            "due_at": "2026-11-02T23:59:00Z",
            **fields,
        }
        response = client.post("/api/assignments", json=body, headers=headers)
        assert response.status_code == 201, response.text
        return response.json()

    return _make_assignment
