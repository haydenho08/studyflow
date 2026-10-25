import pytest
from sqlalchemy import func, select, text

from app.models import Assignment


@pytest.fixture
def course(alice, make_course):
    return make_course(alice, code="EECS 1012")


def ids(response):
    assert response.status_code == 200, response.text
    return [a["id"] for a in response.json()]


# --- create / read ---------------------------------------------------------------------------


def test_create_assignment_applies_defaults(client, alice, course, make_assignment):
    created = make_assignment(alice, course["id"], title="  Lab 1  ")

    assert created["title"] == "Lab 1"
    assert created["kind"] == "assignment"
    assert created["priority"] == "medium"
    assert created["status"] == "todo"
    assert created["description"] is None
    assert client.get(f"/api/assignments/{created['id']}", headers=alice).json() == created


def test_due_at_is_stored_and_returned_in_utc(client, alice, course, make_assignment):
    # 23:59 in Toronto (EST, UTC-5) on Nov 2 is 04:59 UTC on Nov 3.
    created = make_assignment(alice, course["id"], due_at="2026-11-02T23:59:00-05:00")
    assert created["due_at"] == "2026-11-03T04:59:00Z"


@pytest.mark.parametrize(
    "fields",
    [
        {"due_at": "2026-11-02T23:59:00"},  # no timezone
        {"due_at": "next tuesday"},
        {"priority": "urgent"},
        {"status": "finished"},
        {"kind": "essay"},
        {"title": ""},
        {"title": None},
        {"user_id": 1},  # ownership can't be set from the body
    ],
    ids=[
        "naive-datetime",
        "unparseable-date",
        "bad-priority",
        "bad-status",
        "bad-kind",
        "empty-title",
        "null-title",
        "unknown-field",
    ],
)
def test_create_validation_errors(client, alice, course, fields):
    body = {"course_id": course["id"], "title": "Lab 1", "due_at": "2026-11-02T23:59:00Z", **fields}
    assert client.post("/api/assignments", json=body, headers=alice).status_code == 422


def test_cannot_create_assignment_in_someone_elses_course(client, bob, course):
    body = {"course_id": course["id"], "title": "Sneaky", "due_at": "2026-11-02T23:59:00Z"}
    assert client.post("/api/assignments", json=body, headers=bob).status_code == 404


# --- filtering -------------------------------------------------------------------------------


@pytest.fixture
def two_courses_of_work(alice, make_course, make_assignment):
    eecs = make_course(alice, code="EECS 1012")
    math = make_course(alice, code="MATH 1090")
    return {
        "eecs": eecs,
        "math": math,
        "lab": make_assignment(
            alice, eecs["id"], title="Lab", kind="lab", due_at="2026-11-02T12:00:00Z", status="done"
        ),
        "quiz": make_assignment(
            alice,
            math["id"],
            title="Quiz",
            kind="quiz",
            due_at="2026-11-04T12:00:00Z",
            priority="high",
        ),
        "exam": make_assignment(
            alice,
            eecs["id"],
            title="Midterm",
            kind="exam",
            due_at="2026-11-09T12:00:00Z",
            status="in_progress",
        ),
    }


def test_list_is_sorted_by_due_date(client, alice, two_courses_of_work):
    w = two_courses_of_work
    assert ids(client.get("/api/assignments", headers=alice)) == [
        w["lab"]["id"],
        w["quiz"]["id"],
        w["exam"]["id"],
    ]


def test_filter_by_course(client, alice, two_courses_of_work):
    w = two_courses_of_work
    response = client.get("/api/assignments", params={"course_id": w["eecs"]["id"]}, headers=alice)
    assert ids(response) == [w["lab"]["id"], w["exam"]["id"]]


def test_filter_by_status_priority_and_kind(client, alice, two_courses_of_work):
    w = two_courses_of_work
    get = lambda **p: ids(client.get("/api/assignments", params=p, headers=alice))  # noqa: E731

    assert get(status="in_progress") == [w["exam"]["id"]]
    assert get(status="todo") == [w["quiz"]["id"]]
    assert get(priority="high") == [w["quiz"]["id"]]
    assert get(kind="lab") == [w["lab"]["id"]]
    assert get(course_id=w["eecs"]["id"], status="done") == [w["lab"]["id"]]


def test_filter_by_several_statuses(client, alice, two_courses_of_work):
    w = two_courses_of_work
    # Repeated parameter = OR: everything that isn't done.
    params = [("status", "todo"), ("status", "in_progress")]
    assert ids(client.get("/api/assignments", params=params, headers=alice)) == [
        w["quiz"]["id"],
        w["exam"]["id"],
    ]
    # Combined with a date bound: "overdue" = not done and due before a moment.
    params += [("due_to", "2026-11-05T00:00:00Z")]
    assert ids(client.get("/api/assignments", params=params, headers=alice)) == [w["quiz"]["id"]]


def test_filter_by_due_range_is_half_open(client, alice, two_courses_of_work):
    w = two_courses_of_work
    # [Nov 2 12:00, Nov 9 12:00): includes the lab exactly at the start,
    # excludes the exam exactly at the end.
    params = {"due_from": "2026-11-02T12:00:00Z", "due_to": "2026-11-09T12:00:00Z"}
    assert ids(client.get("/api/assignments", params=params, headers=alice)) == [
        w["lab"]["id"],
        w["quiz"]["id"],
    ]


def test_due_range_accepts_offsets(client, alice, two_courses_of_work):
    w = two_courses_of_work
    # Nov 4 08:00 in Toronto is Nov 4 13:00 UTC, which is after the quiz.
    params = {"due_from": "2026-11-04T08:00:00-05:00"}
    assert ids(client.get("/api/assignments", params=params, headers=alice)) == [w["exam"]["id"]]


@pytest.mark.parametrize(
    "params",
    [
        {"due_from": "2026-11-09T00:00:00Z", "due_to": "2026-11-02T00:00:00Z"},
        {"due_from": "2026-11-02T00:00:00Z", "due_to": "2026-11-02T00:00:00Z"},
        {"due_from": "2026-11-02T00:00:00"},
        {"status": "finished"},
    ],
    ids=["reversed-range", "empty-range", "naive-datetime", "bad-status"],
)
def test_filter_validation_errors(client, alice, params):
    assert client.get("/api/assignments", params=params, headers=alice).status_code == 422


# --- update ----------------------------------------------------------------------------------


def test_patch_updates_only_sent_fields(client, alice, course, make_assignment):
    a = make_assignment(alice, course["id"], description="Read chapter 3")

    response = client.patch(f"/api/assignments/{a['id']}", json={"status": "done"}, headers=alice)

    assert response.status_code == 200
    updated = response.json()
    assert updated["status"] == "done"
    assert updated["title"] == a["title"]
    assert updated["description"] == "Read chapter 3"
    assert updated["due_at"] == a["due_at"]


def test_patch_can_clear_nullable_description(client, alice, course, make_assignment):
    a = make_assignment(alice, course["id"], description="Read chapter 3")
    response = client.patch(
        f"/api/assignments/{a['id']}", json={"description": None}, headers=alice
    )
    assert response.status_code == 200
    assert response.json()["description"] is None


@pytest.mark.parametrize(
    "patch",
    [
        {"title": None},
        {"due_at": None},
        {"status": None},
        {"course_id": None},
        {"due_at": "2026-11-02T23:59:00"},
    ],
    ids=["null-title", "null-due-at", "null-status", "null-course", "naive-due-at"],
)
def test_patch_validation_errors(client, alice, course, make_assignment, patch):
    a = make_assignment(alice, course["id"])
    assert client.patch(f"/api/assignments/{a['id']}", json=patch, headers=alice).status_code == 422


def test_patch_can_move_assignment_to_another_own_course(
    client, alice, course, make_course, make_assignment
):
    other = make_course(alice, code="MATH 1090")
    a = make_assignment(alice, course["id"])

    response = client.patch(
        f"/api/assignments/{a['id']}", json={"course_id": other["id"]}, headers=alice
    )

    assert response.status_code == 200
    assert response.json()["course_id"] == other["id"]


def test_patch_cannot_move_assignment_into_someone_elses_course(
    client, alice, bob, course, make_course, make_assignment
):
    bobs_course = make_course(bob, code="BOB 1000")
    a = make_assignment(alice, course["id"])

    response = client.patch(
        f"/api/assignments/{a['id']}", json={"course_id": bobs_course["id"]}, headers=alice
    )

    assert response.status_code == 404
    assert (
        client.get(f"/api/assignments/{a['id']}", headers=alice).json()["course_id"] == course["id"]
    )


# --- isolation -------------------------------------------------------------------------------


def test_users_cannot_see_or_touch_each_others_assignments(
    client, alice, bob, course, make_assignment
):
    a = make_assignment(alice, course["id"])
    url = f"/api/assignments/{a['id']}"

    assert client.get("/api/assignments", headers=bob).json() == []
    assert (
        client.get("/api/assignments", params={"course_id": course["id"]}, headers=bob).json() == []
    )
    assert client.get(url, headers=bob).status_code == 404
    assert client.patch(url, json={"status": "done"}, headers=bob).status_code == 404
    assert client.delete(url, headers=bob).status_code == 404

    assert client.get(url, headers=alice).json() == a


# --- delete / cascade ------------------------------------------------------------------------


def test_delete_assignment(client, alice, course, make_assignment):
    a = make_assignment(alice, course["id"])
    assert client.delete(f"/api/assignments/{a['id']}", headers=alice).status_code == 204
    assert client.get(f"/api/assignments/{a['id']}", headers=alice).status_code == 404


def test_deleting_course_deletes_its_assignments(
    client, alice, course, make_course, make_assignment, db
):
    other = make_course(alice, code="MATH 1090")
    doomed = [make_assignment(alice, course["id"], title=f"Lab {i}") for i in range(3)]
    survivor = make_assignment(alice, other["id"])

    assert client.delete(f"/api/courses/{course['id']}", headers=alice).status_code == 204

    for a in doomed:
        assert client.get(f"/api/assignments/{a['id']}", headers=alice).status_code == 404
    assert ids(client.get("/api/assignments", headers=alice)) == [survivor["id"]]
    assert db.scalar(select(func.count()).select_from(Assignment)) == 1


def test_cascade_is_enforced_by_the_database(alice, course, make_assignment, db):
    """Deleting with raw SQL (no ORM involved) still removes the children: the FK does the work."""
    make_assignment(alice, course["id"])

    db.execute(text("DELETE FROM courses WHERE id = :id"), {"id": course["id"]})
    db.commit()

    assert db.scalar(select(func.count()).select_from(Assignment)) == 0
