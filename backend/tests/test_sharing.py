"""Shared courses: invite links, what members can and can't do, and progress that stays personal."""

from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import func, select

from app.models import AssignmentProgress, CourseMember, StudySession


@pytest.fixture
def course(alice, make_course):
    return make_course(alice, code="EECS 2311", name="Software Development Project")


def invite_path(client, headers, course_id) -> str:
    response = client.post(f"/api/courses/{course_id}/invite", headers=headers)
    assert response.status_code == 200, response.text
    return response.json()["path"]


def token_of(path: str) -> str:
    return path.removeprefix("/join/")


@pytest.fixture
def shared(client, alice, bob, course):
    """Alice's course, which Bob has joined through its invite link."""
    token = token_of(invite_path(client, alice, course["id"]))
    response = client.post(f"/api/invites/{token}", headers=bob)
    assert response.status_code == 200, response.text
    return course


def courses_of(client, headers) -> list[dict]:
    return client.get("/api/courses", headers=headers).json()


def titles(client, headers, **params) -> list[str]:
    return [
        a["title"] for a in client.get("/api/assignments", params=params, headers=headers).json()
    ]


# --- the invite link --------------------------------------------------------------------------


def test_sharing_is_off_until_turned_on(client, alice, course):
    assert client.get(f"/api/courses/{course['id']}/invite", headers=alice).json() == {"path": None}


def test_an_invite_link_is_a_secret_path(client, alice, course):
    path = invite_path(client, alice, course["id"])
    assert path.startswith("/join/") and len(token_of(path)) == 43  # 256 random bits
    assert client.get(f"/api/courses/{course['id']}/invite", headers=alice).json() == {"path": path}


def test_preview_before_joining(client, alice, bob, course):
    token = token_of(invite_path(client, alice, course["id"]))

    preview = client.get(f"/api/invites/{token}", headers=bob).json()

    assert preview == {
        "course_id": course["id"],
        "code": "EECS 2311",
        "name": "Software Development Project",
        "color": course["color"],
        "owner_email": "alice@example.com",
        "member_count": 0,
        "role": None,
    }


def test_invites_need_a_login(client, alice, course):
    token = token_of(invite_path(client, alice, course["id"]))
    assert client.get(f"/api/invites/{token}").status_code == 401
    assert client.post(f"/api/invites/{token}").status_code == 401


@pytest.mark.parametrize("token", ["x" * 43, "nope", "%00", "a" * 300])
def test_unknown_invite_links_are_404(client, bob, token):
    assert client.get(f"/api/invites/{token}", headers=bob).status_code == 404
    assert client.post(f"/api/invites/{token}", headers=bob).status_code == 404


def test_joining(client, bob, shared):
    [joined] = courses_of(client, bob)
    assert joined["id"] == shared["id"]
    assert (joined["role"], joined["owner_email"], joined["member_count"]) == (
        "member",
        "alice@example.com",
        1,
    )


def test_the_owner_sees_the_member_count(client, alice, shared):
    [own] = courses_of(client, alice)
    assert (own["role"], own["member_count"]) == ("owner", 1)


def test_joining_twice_is_harmless(client, alice, bob, shared, db):
    token = token_of(
        client.get(f"/api/courses/{shared['id']}/invite", headers=alice).json()["path"]
    )
    assert client.post(f"/api/invites/{token}", headers=bob).status_code == 200
    assert db.scalar(select(func.count()).select_from(CourseMember)) == 1
    assert client.get(f"/api/invites/{token}", headers=bob).json()["role"] == "member"


def test_the_owner_cant_join_their_own_course(client, alice, course):
    token = token_of(invite_path(client, alice, course["id"]))
    assert client.post(f"/api/invites/{token}", headers=alice).status_code == 409


def test_a_new_link_stops_the_old_one_but_keeps_members(client, alice, bob, make_user, shared):
    old = token_of(client.get(f"/api/courses/{shared['id']}/invite", headers=alice).json()["path"])
    new = token_of(invite_path(client, alice, shared["id"]))
    carol = make_user("carol@example.com")

    assert client.post(f"/api/invites/{old}", headers=carol).status_code == 404
    assert client.post(f"/api/invites/{new}", headers=carol).status_code == 200
    assert len(courses_of(client, bob)) == 1  # Bob is still in


def test_turning_sharing_off(client, alice, make_user, course):
    token = token_of(invite_path(client, alice, course["id"]))
    assert client.delete(f"/api/courses/{course['id']}/invite", headers=alice).status_code == 204
    carol = make_user("carol@example.com")
    assert client.post(f"/api/invites/{token}", headers=carol).status_code == 404


# --- what members can do ----------------------------------------------------------------------


def test_members_see_the_shared_deadlines(client, alice, bob, shared, make_assignment):
    make_assignment(alice, shared["id"], title="Sprint 1 demo")
    assert titles(client, bob) == ["Sprint 1 demo"]


def test_members_can_add_and_edit_deadlines_for_everyone(
    client, alice, bob, shared, make_assignment
):
    added = make_assignment(bob, shared["id"], title="Retrospective")
    client.patch(f"/api/assignments/{added['id']}", json={"title": "Sprint retro"}, headers=bob)
    assert titles(client, alice) == ["Sprint retro"]


def test_members_can_log_study_time_on_it(client, bob, shared):
    end = datetime.now(UTC) - timedelta(minutes=5)
    body = {
        "course_id": shared["id"],
        "started_at": (end - timedelta(minutes=25)).isoformat(),
        "ended_at": end.isoformat(),
    }
    assert client.post("/api/study-sessions", json=body, headers=bob).status_code == 201


@pytest.mark.parametrize(
    ("method", "suffix", "body"),
    [
        ("PATCH", "", {"name": "Renamed"}),
        ("DELETE", "", None),
        ("GET", "/invite", None),
        ("POST", "/invite", None),
        ("DELETE", "/invite", None),
    ],
    ids=["rename", "delete", "see-link", "new-link", "link-off"],
)
def test_owner_only_actions_are_403_for_members(client, bob, shared, method, suffix, body):
    url = f"/api/courses/{shared['id']}{suffix}"
    assert client.request(method, url, json=body, headers=bob).status_code == 403


@pytest.mark.parametrize(
    ("method", "suffix"),
    [("GET", ""), ("PATCH", ""), ("DELETE", ""), ("GET", "/invite"), ("GET", "/members")],
)
def test_outsiders_still_get_404(client, make_user, shared, method, suffix):
    carol = make_user("carol@example.com")
    url = f"/api/courses/{shared['id']}{suffix}"
    assert client.request(method, url, json={}, headers=carol).status_code == 404


def test_outsiders_cant_use_the_shared_deadlines(client, alice, make_user, shared, make_assignment):
    lab = make_assignment(alice, shared["id"])
    carol = make_user("carol@example.com")
    assert client.get(f"/api/assignments/{lab['id']}", headers=carol).status_code == 404
    body = {"course_id": shared["id"], "title": "x", "due_at": "2026-11-02T00:00:00Z"}
    assert client.post("/api/assignments", json=body, headers=carol).status_code == 404


# --- progress stays personal ------------------------------------------------------------------


def test_status_is_per_person(client, alice, bob, shared, make_assignment):
    lab = make_assignment(alice, shared["id"], title="Lab 1")
    url = f"/api/assignments/{lab['id']}"

    client.patch(url, json={"status": "done"}, headers=bob)

    assert client.get(url, headers=bob).json()["status"] == "done"
    assert client.get(url, headers=alice).json()["status"] == "todo"
    # The status filter uses your own progress too.
    assert titles(client, bob, status="done") == ["Lab 1"]
    assert titles(client, alice, status="done") == []
    assert titles(client, alice, status="todo") == ["Lab 1"]


def test_marks_and_grades_are_per_person(client, alice, bob, shared, make_assignment):
    midterm = make_assignment(alice, shared["id"], title="Midterm", weight=40)
    url = f"/api/assignments/{midterm['id']}"
    client.patch(url, json={"score": 30, "out_of": 40}, headers=alice)
    client.patch(url, json={"score": 36, "out_of": 40}, headers=bob)

    def grade(headers):
        return client.get("/api/grades", headers=headers).json()[0]["current"]

    assert (grade(alice), grade(bob)) == (75.0, 90.0)
    assert client.get(url, headers=bob).json()["weight"] == 40.0  # the weight is shared


def test_study_time_is_per_person(client, alice, bob, shared):
    end = datetime.now(UTC) - timedelta(hours=1)
    body = {
        "course_id": shared["id"],
        "started_at": (end - timedelta(minutes=25)).isoformat(),
        "ended_at": end.isoformat(),
    }
    # Studying at the same time as a classmate isn't an "overlap": overlaps are per person.
    assert client.post("/api/study-sessions", json=body, headers=alice).status_code == 201
    assert client.post("/api/study-sessions", json=body, headers=bob).status_code == 201

    assert len(client.get("/api/study-sessions", headers=alice).json()) == 1
    alices = client.get("/api/study-sessions", headers=alice).json()[0]["id"]
    assert client.delete(f"/api/study-sessions/{alices}", headers=bob).status_code == 404


def test_the_calendar_feed_shows_your_own_status(client, alice, bob, shared, make_assignment):
    lab = make_assignment(alice, shared["id"], title="Lab 1")
    client.patch(f"/api/assignments/{lab['id']}", json={"status": "done"}, headers=bob)

    def feed(headers):
        return client.get(client.post("/api/calendar-feed", headers=headers).json()["path"]).text

    assert "SUMMARY:✓ EECS 2311: Lab 1" in feed(bob)
    assert "SUMMARY:EECS 2311: Lab 1" in feed(alice)


# --- members, leaving and removing ------------------------------------------------------------


def test_members_list(client, alice, bob, shared):
    for headers in (alice, bob):  # anyone in the course can see who else is
        people = client.get(f"/api/courses/{shared['id']}/members", headers=headers).json()
        assert [(p["email"], p["role"]) for p in people] == [
            ("alice@example.com", "owner"),
            ("bob@example.com", "member"),
        ]
        assert people[0]["joined_at"] is None and people[1]["joined_at"] is not None


def bob_id(client, bob) -> int:
    return client.get("/api/auth/me", headers=bob).json()["id"]


def test_leaving_takes_your_progress_with_you(client, alice, bob, shared, make_assignment, db):
    lab = make_assignment(alice, shared["id"])
    client.patch(f"/api/assignments/{lab['id']}", json={"status": "done"}, headers=bob)
    client.patch(f"/api/assignments/{lab['id']}", json={"status": "in_progress"}, headers=alice)

    response = client.delete(
        f"/api/courses/{shared['id']}/members/{bob_id(client, bob)}", headers=bob
    )

    assert response.status_code == 204
    assert courses_of(client, bob) == []
    assert client.get(f"/api/assignments/{lab['id']}", headers=bob).status_code == 404
    remaining = db.scalars(select(AssignmentProgress.status)).all()
    assert remaining == ["in_progress"]  # Alice's stays


def test_the_owner_can_remove_a_member(client, alice, bob, shared, db):
    end = datetime.now(UTC) - timedelta(minutes=5)
    session = {
        "course_id": shared["id"],
        "started_at": (end - timedelta(minutes=25)).isoformat(),
        "ended_at": end.isoformat(),
    }
    assert client.post("/api/study-sessions", json=session, headers=bob).status_code == 201

    url = f"/api/courses/{shared['id']}/members/{bob_id(client, bob)}"
    assert client.delete(url, headers=alice).status_code == 204

    assert courses_of(client, bob) == []
    assert db.scalar(select(func.count()).select_from(StudySession)) == 0  # his time on it too


def test_members_cant_remove_each_other(client, alice, bob, make_user, shared):
    token = token_of(
        client.get(f"/api/courses/{shared['id']}/invite", headers=alice).json()["path"]
    )
    carol = make_user("carol@example.com")
    client.post(f"/api/invites/{token}", headers=carol)

    url = f"/api/courses/{shared['id']}/members/{bob_id(client, bob)}"
    assert client.delete(url, headers=carol).status_code == 403


def test_the_owner_cant_leave(client, alice, shared):
    alice_id = client.get("/api/auth/me", headers=alice).json()["id"]
    url = f"/api/courses/{shared['id']}/members/{alice_id}"
    assert client.delete(url, headers=alice).status_code == 409


def test_removing_someone_who_isnt_a_member_is_404(client, alice, make_user, shared):
    carol = make_user("carol@example.com")
    carol_id = client.get("/api/auth/me", headers=carol).json()["id"]
    assert (
        client.delete(f"/api/courses/{shared['id']}/members/{carol_id}", headers=alice).status_code
        == 404
    )


def test_deleting_the_course_removes_it_for_everyone(client, alice, bob, shared, make_assignment):
    make_assignment(alice, shared["id"])
    assert client.delete(f"/api/courses/{shared['id']}", headers=alice).status_code == 204
    assert courses_of(client, bob) == []
    assert titles(client, bob) == []


def test_a_member_can_have_their_own_course_with_the_same_code(client, bob, shared, make_course):
    own = make_course(bob, code="EECS 2311")
    assert sorted(c["role"] for c in courses_of(client, bob)) == ["member", "owner"]
    assert own["role"] == "owner"
