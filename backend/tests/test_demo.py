"""The one-click demo login, and how it keeps the demo data fresh."""

import pytest
from sqlalchemy import text

from app.config import get_settings
from app.demo import ASSIGNMENTS, COURSES, DEMO_EMAIL


@pytest.fixture
def demo_on(monkeypatch):
    monkeypatch.setattr(get_settings(), "demo_enabled", True)


def demo_headers(client, tz="America/Toronto"):
    response = client.post("/api/auth/demo", json={"tz": tz})
    assert response.status_code == 200, response.text
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


def course_ids(client, headers):
    return sorted(c["id"] for c in client.get("/api/courses", headers=headers).json())


def test_demo_is_off_unless_enabled(client):
    assert client.post("/api/auth/demo").status_code == 404


def test_demo_login_creates_a_full_account(client, demo_on):
    headers = demo_headers(client)

    assert client.get("/api/auth/me", headers=headers).json()["email"] == DEMO_EMAIL
    assert len(client.get("/api/courses", headers=headers).json()) == len(COURSES)
    assert len(client.get("/api/assignments", headers=headers).json()) == len(ASSIGNMENTS)
    sessions = client.get("/api/study-sessions", headers=headers).json()
    assert len(sessions) >= 20  # today's early sessions are skipped if they haven't ended yet


def test_demo_always_has_exactly_one_overdue_deadline(client, demo_on):
    """Deadlines are relative to today, so the demo looks the same on any day of the week."""
    headers = demo_headers(client)
    from datetime import UTC, datetime

    now = datetime.now(UTC).isoformat()
    params = [("status", "todo"), ("status", "in_progress"), ("due_to", now)]
    overdue = client.get("/api/assignments", params=params, headers=headers).json()
    assert [a["title"] for a in overdue] == ["Quiz 3: Assembly"]


def test_body_is_optional(client, demo_on):
    assert client.post("/api/auth/demo").status_code == 200


def test_fresh_demo_is_not_rebuilt_on_every_click(client, demo_on):
    first = course_ids(client, demo_headers(client))
    second = course_ids(client, demo_headers(client))
    assert first == second  # same rows: nothing was deleted and recreated


def test_stale_demo_is_rebuilt_and_visitor_changes_are_cleared(client, demo_on, db):
    headers = demo_headers(client)
    original = course_ids(client, headers)
    response = client.post("/api/courses", json={"name": "Spam", "code": "JUNK 1"}, headers=headers)
    assert response.status_code == 201

    # Within the hour, a visitor's change stays (others may be looking at it).
    assert len(course_ids(client, demo_headers(client))) == len(COURSES) + 1

    # Make the demo data look two hours old.
    db.execute(text("UPDATE courses SET created_at = created_at - interval '2 hours'"))
    db.commit()

    rebuilt = course_ids(client, demo_headers(client))
    assert len(rebuilt) == len(COURSES)  # the junk course is gone
    assert set(rebuilt).isdisjoint(original)  # brand-new rows


def test_demo_rebuilds_if_a_visitor_deleted_every_course(client, demo_on):
    headers = demo_headers(client)
    for cid in course_ids(client, headers):
        client.delete(f"/api/courses/{cid}", headers=headers)

    assert len(course_ids(client, demo_headers(client))) == len(COURSES)


def test_the_demo_cannot_be_logged_into_with_a_password(client, demo_on):
    demo_headers(client)
    for password in ["studyflow-demo", "password", ""]:
        response = client.post(
            "/api/auth/login", data={"username": DEMO_EMAIL, "password": password}
        )
        assert response.status_code in (401, 422)


def test_demo_rejects_bad_time_zones(client, demo_on):
    assert client.post("/api/auth/demo", json={"tz": "Mars/Base"}).status_code == 422
    assert client.post("/api/auth/demo", json={"tz": "UTC", "admin": True}).status_code == 422


def test_simultaneous_clicks_on_a_stale_demo_rebuild_it_once(client, demo_on, db, monkeypatch):
    """Two visitors at the same moment: without the row lock, both would delete and re-insert the
    courses and one would crash on the (user_id, code) unique constraint."""
    import time
    from concurrent.futures import ThreadPoolExecutor
    from threading import Barrier
    from zoneinfo import ZoneInfo

    import app.demo
    from app.demo import ensure_fresh_demo
    from tests.conftest import TestingSessionLocal

    demo_headers(client)  # create the demo once

    # Slow the rebuild down so the two clicks are guaranteed to overlap. Otherwise the first
    # finishes before the second even checks, and the test passes with or without the lock.
    real_hash = app.demo.hash_password

    def slow_hash(password: str) -> str:
        time.sleep(0.3)
        return real_hash(password)

    monkeypatch.setattr(app.demo, "hash_password", slow_hash)
    db.execute(text("UPDATE courses SET created_at = created_at - interval '2 hours'"))
    db.commit()

    start_together = Barrier(2)

    def click():
        with TestingSessionLocal() as session:
            start_together.wait()
            return ensure_fresh_demo(session, ZoneInfo("America/Toronto")).id

    with ThreadPoolExecutor(max_workers=2) as pool:
        user_ids = list(pool.map(lambda _: click(), range(2)))  # raises if either thread failed

    assert user_ids[0] == user_ids[1]
    assert len(course_ids(client, demo_headers(client))) == len(COURSES)  # rebuilt exactly once


def test_demo_does_not_touch_real_users(client, demo_on, alice, make_course):
    course = make_course(alice)
    demo_headers(client)
    assert client.get(f"/api/courses/{course['id']}", headers=alice).status_code == 200
