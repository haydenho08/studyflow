"""Production concerns: serving the built frontend, and host-provided database URLs."""

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app


@pytest.fixture
def site(tmp_path):
    """An app serving a fake frontend build: index.html plus one hashed asset."""
    (tmp_path / "index.html").write_text("<!doctype html><div id=root></div>", encoding="utf-8")
    (tmp_path / "assets").mkdir()
    (tmp_path / "assets" / "index-abc123.js").write_text("console.log('hi')", encoding="utf-8")
    with TestClient(create_app(static_dir=tmp_path)) as client:
        yield client


@pytest.mark.parametrize("path", ["/", "/calendar", "/stats?week=2026-10-19", "/no/such/page"])
def test_page_routes_get_index_html(site, path):
    response = site.get(path)
    assert response.status_code == 200
    assert "<div id=root>" in response.text
    assert response.headers["cache-control"] == "no-cache"  # always pick up a new build


def test_hashed_assets_are_cached_forever(site):
    response = site.get("/assets/index-abc123.js")
    assert response.status_code == 200
    assert "immutable" in response.headers["cache-control"]


def test_missing_asset_is_a_real_404_not_html(site):
    response = site.get("/assets/index-gone.js")
    assert response.status_code == 404
    assert "<div id=root>" not in response.text


@pytest.mark.parametrize(("method", "path"), [("GET", "/api/nope"), ("POST", "/api/nope")])
def test_unknown_api_paths_stay_json_404s(site, method, path):
    response = site.request(method, path)
    assert response.status_code == 404
    assert response.json() == {"detail": "Not Found"}


def test_api_and_docs_still_work_next_to_the_frontend(site):
    assert site.get("/api/health").json() == {"status": "ok"}
    assert site.get("/docs").status_code == 200
    assert "openapi" in site.get("/openapi.json").json()


def test_api_errors_keep_their_own_messages(site):
    # A real API 404 (e.g. someone else's course) must not be swallowed by the page fallback.
    response = site.get("/api/auth/me")
    assert response.status_code == 401


def test_no_frontend_build_means_api_only(tmp_path):
    with TestClient(create_app(static_dir=tmp_path)) as client:  # empty dir: no index.html
        assert client.get("/calendar").status_code == 404


@pytest.mark.parametrize(
    "given",
    [
        "postgres://u:p@host.neon.tech/db?sslmode=require",
        "postgresql://u:p@host.neon.tech/db?sslmode=require",
        "postgresql+psycopg://u:p@host.neon.tech/db?sslmode=require",
    ],
)
def test_host_database_urls_use_the_psycopg_driver(given):
    settings = Settings(database_url=given, jwt_secret_key="x" * 32)
    assert settings.database_url == "postgresql+psycopg://u:p@host.neon.tech/db?sslmode=require"
