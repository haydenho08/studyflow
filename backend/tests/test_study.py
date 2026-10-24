from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import func, select

from app.models import StudySession

# Fixed dates must stay in the past forever: the API rejects sessions that end in the future.
# Week of Monday 2026-10-12. Toronto is on EDT (UTC-4) all week.


@pytest.fixture
def eecs(alice, make_course):
    return make_course(alice, code="EECS 1012")


@pytest.fixture
def math(alice, make_course):
    return make_course(alice, code="MATH 1090")


@pytest.fixture
def log(client):
    """POST a session of `minutes` starting at `start` (ISO string). Returns the response."""

    def _log(headers, course_id, start, minutes=25):
        started = datetime.fromisoformat(start)
        body = {
            "course_id": course_id,
            "started_at": started.isoformat(),
            "ended_at": (started + timedelta(minutes=minutes)).isoformat(),
        }
        return client.post("/api/study-sessions", json=body, headers=headers)

    return _log


# --- create -----------------------------------------------------------------------------------


def test_log_session_returns_utc_times_and_duration(alice, eecs, log):
    response = log(alice, eecs["id"], "2026-10-12T10:00:00-04:00", minutes=25)

    assert response.status_code == 201
    body = response.json()
    assert body["started_at"] == "2026-10-12T14:00:00Z"
    assert body["ended_at"] == "2026-10-12T14:25:00Z"
    assert body["duration_seconds"] == 25 * 60


@pytest.mark.parametrize(
    ("start", "end"),
    [
        ("2026-10-12T10:00:00", "2026-10-12T10:25:00"),  # no timezone
        ("2026-10-12T10:25:00Z", "2026-10-12T10:00:00Z"),  # ends before it starts
        ("2026-10-12T10:00:00Z", "2026-10-12T10:00:00Z"),  # zero length
        ("2026-10-12T10:00:00Z", "2026-10-12T10:00:30Z"),  # under a minute
        ("2026-10-12T08:00:00Z", "2026-10-12T20:01:00Z"),  # over 12 hours
    ],
    ids=["naive", "backwards", "zero-length", "too-short", "too-long"],
)
def test_invalid_session_times(client, alice, eecs, start, end):
    body = {"course_id": eecs["id"], "started_at": start, "ended_at": end}
    assert client.post("/api/study-sessions", json=body, headers=alice).status_code == 422


def test_session_cannot_end_in_the_future(alice, eecs, log):
    soon = datetime.now(UTC) + timedelta(minutes=10)
    assert log(alice, eecs["id"], soon.isoformat()).status_code == 422


def test_cannot_log_to_someone_elses_course(bob, eecs, log):
    assert log(bob, eecs["id"], "2026-10-12T10:00:00Z").status_code == 404


def test_overlapping_sessions_are_rejected_across_courses(alice, eecs, math, log):
    assert log(alice, eecs["id"], "2026-10-12T10:00:00Z", minutes=25).status_code == 201

    # Starts inside, contains, or ends inside the existing session: all conflicts, even on another course.
    assert log(alice, math["id"], "2026-10-12T10:10:00Z", minutes=25).status_code == 409
    assert log(alice, math["id"], "2026-10-12T09:50:00Z", minutes=60).status_code == 409
    assert log(alice, math["id"], "2026-10-12T09:50:00Z", minutes=15).status_code == 409


def test_back_to_back_sessions_are_allowed(alice, eecs, log):
    assert log(alice, eecs["id"], "2026-10-12T10:00:00Z", minutes=25).status_code == 201
    assert log(alice, eecs["id"], "2026-10-12T10:25:00Z", minutes=25).status_code == 201
    assert log(alice, eecs["id"], "2026-10-12T09:35:00Z", minutes=25).status_code == 201


def test_other_users_sessions_do_not_count_as_overlaps(alice, bob, eecs, make_course, log):
    bobs = make_course(bob, code="BOB 1000")
    assert log(alice, eecs["id"], "2026-10-12T10:00:00Z").status_code == 201
    assert log(bob, bobs["id"], "2026-10-12T10:00:00Z").status_code == 201


# --- list / delete ----------------------------------------------------------------------------


def test_list_is_newest_first_and_filterable(client, alice, eecs, math, log):
    first = log(alice, eecs["id"], "2026-10-12T10:00:00Z").json()
    second = log(alice, math["id"], "2026-10-13T10:00:00Z").json()
    third = log(alice, eecs["id"], "2026-10-14T10:00:00Z").json()

    def ids(**params):
        response = client.get("/api/study-sessions", params=params, headers=alice)
        assert response.status_code == 200
        return [s["id"] for s in response.json()]

    assert ids() == [third["id"], second["id"], first["id"]]
    assert ids(course_id=eecs["id"]) == [third["id"], first["id"]]
    assert ids(started_from="2026-10-13T00:00:00Z", started_to="2026-10-14T00:00:00Z") == [second["id"]]
    assert ids(limit=1) == [third["id"]]


def test_sessions_are_private(client, alice, bob, eecs, log):
    session = log(alice, eecs["id"], "2026-10-12T10:00:00Z").json()

    assert client.get("/api/study-sessions", headers=bob).json() == []
    assert client.delete(f"/api/study-sessions/{session['id']}", headers=bob).status_code == 404
    assert len(client.get("/api/study-sessions", headers=alice).json()) == 1


def test_delete_session(client, alice, eecs, log):
    session = log(alice, eecs["id"], "2026-10-12T10:00:00Z").json()
    assert client.delete(f"/api/study-sessions/{session['id']}", headers=alice).status_code == 204
    assert client.get("/api/study-sessions", headers=alice).json() == []


def test_deleting_course_deletes_its_sessions(client, alice, eecs, log, db):
    log(alice, eecs["id"], "2026-10-12T10:00:00Z")
    assert client.delete(f"/api/courses/{eecs['id']}", headers=alice).status_code == 204
    assert db.scalar(select(func.count()).select_from(StudySession)) == 0


# --- weekly stats -----------------------------------------------------------------------------


@pytest.fixture
def week_of_study(alice, bob, eecs, math, make_course, log):
    sessions = [
        (eecs, "2026-10-12T10:00:00-04:00", 25),  # Mon morning
        (eecs, "2026-10-12T22:00:00-04:00", 50),  # Mon 22:00 Toronto = Tue 02:00 UTC
        (math, "2026-10-14T09:00:00-04:00", 60),  # Wed
        (eecs, "2026-10-11T23:00:00-04:00", 30),  # Sunday before: outside the week
        (eecs, "2026-10-19T00:30:00-04:00", 30),  # Monday after: outside the week
    ]
    for course, start, minutes in sessions:
        assert log(alice, course["id"], start, minutes).status_code == 201
    # Bob's study must never show up in Alice's stats.
    bobs = make_course(bob, code="BOB 1000")
    assert log(bob, bobs["id"], "2026-10-12T12:00:00-04:00", 120).status_code == 201
    return {"eecs": eecs, "math": math}


def week(client, headers, start="2026-10-12", tz="America/Toronto"):
    response = client.get("/api/stats/week", params={"start": start, "tz": tz}, headers=headers)
    assert response.status_code == 200, response.text
    return response.json()


def test_week_stats_totals_and_per_course(client, alice, week_of_study):
    eecs, math = week_of_study["eecs"], week_of_study["math"]
    stats = week(client, alice)

    assert stats["start"] == "2026-10-12"
    assert stats["total_seconds"] == (25 + 50 + 60) * 60
    assert stats["session_count"] == 3
    # Most-studied course first.
    assert stats["courses"] == [
        {"course_id": eecs["id"], "seconds": 75 * 60, "sessions": 2},
        {"course_id": math["id"], "seconds": 60 * 60, "sessions": 1},
    ]


def test_week_stats_has_seven_days_bucketed_in_local_time(client, alice, week_of_study):
    eecs, math = week_of_study["eecs"], week_of_study["math"]
    days = week(client, alice)["days"]

    assert [d["day"] for d in days] == [f"2026-10-{n}" for n in range(12, 19)]
    totals = {d["day"]: d["total_seconds"] for d in days}
    # The 22:00 session counts on Monday in Toronto, even though it's Tuesday in UTC.
    assert totals["2026-10-12"] == 75 * 60
    assert totals["2026-10-13"] == 0
    assert totals["2026-10-14"] == 60 * 60
    assert days[0]["courses"] == [{"course_id": eecs["id"], "seconds": 75 * 60}]
    assert days[2]["courses"] == [{"course_id": math["id"], "seconds": 60 * 60}]


def test_same_sessions_bucket_differently_in_utc(client, alice, week_of_study):
    stats = week(client, alice, tz="UTC")
    totals = {d["day"]: d["total_seconds"] for d in stats["days"]}
    # In UTC, "Sunday 23:00 Toronto" is Monday 03:00, so it moves *into* the week (25 + 30 min),
    # and "Monday 22:00 Toronto" moves to Tuesday.
    assert totals["2026-10-12"] == (25 + 30) * 60
    assert totals["2026-10-13"] == 50 * 60
    assert stats["session_count"] == 4


def test_week_containing_dst_change_uses_local_midnights(client, alice, eecs, log):
    # Clocks spring forward on Sunday 2026-03-08, so the week Mon Mar 2 - Sun Mar 8 is 167 hours.
    assert log(alice, eecs["id"], "2026-03-08T23:30:00-04:00", 20).status_code == 201  # Sun night: in
    assert log(alice, eecs["id"], "2026-03-09T00:30:00-04:00", 20).status_code == 201  # Mon: out
    # A window computed in UTC ("start + 168 hours") would end at 01:00 local on Monday and wrongly
    # include the 00:30 session. (Python's aware-datetime + timedelta is wall-clock arithmetic and
    # gets this right; converting to UTC first is the bug this test catches.)

    stats = week(client, alice, start="2026-03-02")

    assert stats["session_count"] == 1
    assert stats["days"][6] == {"day": "2026-03-08", "total_seconds": 20 * 60, "courses": [
        {"course_id": eecs["id"], "seconds": 20 * 60}
    ]}


def test_empty_week_is_all_zeros(client, alice):
    stats = week(client, alice)
    assert stats["total_seconds"] == 0
    assert stats["courses"] == []
    assert [d["total_seconds"] for d in stats["days"]] == [0] * 7


@pytest.mark.parametrize(
    "params",
    [
        {"start": "2026-10-12", "tz": "Mars/Olympus_Mons"},
        {"start": "2026-10-12", "tz": "../../etc/passwd"},
        {"start": "2026-10-12"},
        {"start": "not-a-date", "tz": "UTC"},
    ],
    ids=["unknown-zone", "path-traversal-zone", "missing-zone", "bad-date"],
)
def test_week_stats_validation(client, alice, params):
    assert client.get("/api/stats/week", params=params, headers=alice).status_code == 422


def test_stats_require_auth(client):
    assert client.get("/api/stats/week", params={"start": "2026-10-12", "tz": "UTC"}).status_code == 401
