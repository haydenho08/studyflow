"""Repeating deadlines: the weekly rule (DST included), creating a series, and editing or
deleting "this and following"."""

from datetime import UTC, date, datetime
from zoneinfo import ZoneInfo

import pytest

from app.recurrence import RecurrenceError, number_title, shift_wall_clock, weekly_due_dates

TORONTO = ZoneInfo("America/Toronto")  # clocks go back on Sun 1 Nov 2026
FRI, TUE, THU, SUN = 4, 1, 3, 6


def utc(text: str) -> datetime:
    return datetime.fromisoformat(text).replace(tzinfo=UTC)


def iso(moments: list[datetime]) -> list[str]:
    return [m.strftime("%Y-%m-%dT%H:%M") for m in moments]


# --- the rule ---------------------------------------------------------------------------------


def test_weekly_keeps_the_wall_clock_time_through_a_dst_change():
    # Friday 23:59 in Toronto: 03:59 UTC while on daylight time, 04:59 UTC after 1 November.
    first = datetime(2026, 10, 23, 23, 59, tzinfo=TORONTO)
    dates = weekly_due_dates(first, TORONTO, {FRI}, count=3)
    assert iso(dates) == ["2026-10-24T03:59", "2026-10-31T03:59", "2026-11-07T04:59"]
    assert all(d.astimezone(TORONTO).strftime("%a %H:%M") == "Fri 23:59" for d in dates)


def test_several_days_every_other_week():
    first = datetime(2026, 11, 3, 10, 0, tzinfo=TORONTO)  # a Tuesday
    dates = weekly_due_dates(first, TORONTO, {TUE, THU}, every_weeks=2, count=4)
    days = [d.astimezone(TORONTO).date().isoformat() for d in dates]
    assert days == ["2026-11-03", "2026-11-05", "2026-11-17", "2026-11-19"]


def test_until_is_inclusive():
    first = datetime(2026, 10, 23, 23, 59, tzinfo=TORONTO)
    dates = weekly_due_dates(first, TORONTO, {FRI}, until=date(2026, 11, 6))
    assert len(dates) == 3  # 23 Oct, 30 Oct and 6 Nov itself


def test_until_is_a_date_in_the_students_zone_not_utc():
    # 6 Nov 23:59 in Toronto is already 7 Nov in UTC; it still counts as "on or before 6 Nov".
    first = datetime(2026, 11, 6, 23, 59, tzinfo=TORONTO)
    assert len(weekly_due_dates(first, TORONTO, {FRI}, until=date(2026, 11, 6))) == 1


def test_a_time_the_clocks_skip_lands_an_hour_later():
    # Sun 14 Mar 2027: 02:00 jumps to 03:00, so "02:30" doesn't exist that night.
    first = datetime(2027, 3, 7, 2, 30, tzinfo=TORONTO)
    second = weekly_due_dates(first, TORONTO, {SUN}, count=2)[1]
    assert second.astimezone(TORONTO).strftime("%Y-%m-%d %H:%M") == "2027-03-14 03:30"


@pytest.mark.parametrize(
    ("kwargs", "message"),
    [
        ({"weekdays": {TUE}, "count": 3}, "repeat days"),
        ({"weekdays": {FRI}, "until": date(2026, 10, 1)}, "end before"),
        ({"weekdays": {FRI}, "until": date(2028, 1, 1)}, "at most a year"),
        ({"weekdays": set(range(7)), "until": date(2027, 1, 1)}, "at most 52"),
    ],
    ids=["first-not-a-repeat-day", "ends-before-it-starts", "too-long", "too-many"],
)
def test_rule_errors(kwargs, message):
    first = datetime(2026, 10, 23, 23, 59, tzinfo=TORONTO)  # a Friday
    with pytest.raises(RecurrenceError, match=message):
        weekly_due_dates(first, TORONTO, **kwargs)


def test_number_title():
    assert number_title("Lab {n}", 3) == "Lab 3"
    assert number_title("Weekly quiz", 3) == "Weekly quiz"


def test_shifting_follows_the_wall_clock_across_dst():
    # The first lab moves from Fri 23 Oct 23:59 to Mon 26 Oct 09:00. A lab on Fri 6 Nov (after
    # the clocks change) moves to Mon 9 Nov 09:00 local time, not 08:00.
    old = datetime(2026, 10, 23, 23, 59, tzinfo=TORONTO)
    new = datetime(2026, 10, 26, 9, 0, tzinfo=TORONTO)
    later = datetime(2026, 11, 6, 23, 59, tzinfo=TORONTO)

    moved = shift_wall_clock(later, old, new, TORONTO)

    assert moved.astimezone(TORONTO).strftime("%a %Y-%m-%d %H:%M") == "Mon 2026-11-09 09:00"


# --- the API ----------------------------------------------------------------------------------


def series_body(course_id: int, **repeat) -> dict:
    return {
        "course_id": course_id,
        "title": "Lab {n}",
        "kind": "lab",
        "due_at": "2026-10-23T23:59:00-04:00",  # Friday, Toronto daylight time
        "repeat": {"weekdays": [FRI], "count": 4, "time_zone": "America/Toronto", **repeat},
    }


@pytest.fixture
def labs(client, alice, make_course):
    """Alice's four weekly labs: Lab 1 … Lab 4, Fridays at 23:59 from 23 October."""
    course = make_course(alice)
    response = client.post("/api/assignments/series", json=series_body(course["id"]), headers=alice)
    assert response.status_code == 201, response.text
    return response.json()


def listed(client, headers) -> list[dict]:
    return client.get("/api/assignments", headers=headers).json()


def test_creating_a_series(client, alice, labs):
    assert [a["title"] for a in labs] == ["Lab 1", "Lab 2", "Lab 3", "Lab 4"]
    assert [a["due_at"] for a in labs] == [
        "2026-10-24T03:59:00Z",
        "2026-10-31T03:59:00Z",
        "2026-11-07T04:59:00Z",  # after the clocks went back: still 23:59 in Toronto
        "2026-11-14T04:59:00Z",
    ]
    assert len({a["series_id"] for a in labs}) == 1 and labs[0]["series_id"] is not None
    assert {a["status"] for a in labs} == {"todo"}
    assert {a["kind"] for a in labs} == {"lab"}
    assert [a["id"] for a in listed(client, alice)] == [a["id"] for a in labs]


def test_one_off_deadlines_have_no_series(client, alice, make_course, make_assignment):
    assert make_assignment(alice, make_course(alice)["id"])["series_id"] is None


def test_two_series_get_different_ids(client, alice, labs):
    body = series_body(labs[0]["course_id"])
    again = client.post("/api/assignments/series", json=body, headers=alice).json()
    assert again[0]["series_id"] != labs[0]["series_id"]


@pytest.mark.parametrize(
    "repeat",
    [
        {"count": 4, "until": "2026-12-01"},
        {"count": None},
        {"weekdays": [FRI, FRI]},
        {"weekdays": []},
        {"weekdays": [7]},
        {"every_weeks": 5},
        {"count": 53},
        {"count": 1},
        {"time_zone": "Mars/Olympus_Mons"},
        {"surprise": True},
    ],
    ids=[
        "count-and-until",
        "no-end",
        "duplicate-day",
        "no-days",
        "day-out-of-range",
        "too-sparse",
        "too-many",
        "just-one",
        "unknown-zone",
        "unknown-field",
    ],
)
def test_series_validation(client, alice, make_course, repeat):
    body = series_body(make_course(alice)["id"], **repeat)
    assert client.post("/api/assignments/series", json=body, headers=alice).status_code == 422


def test_the_first_due_date_must_be_a_repeat_day(client, alice, make_course):
    body = series_body(make_course(alice)["id"], weekdays=[TUE])
    response = client.post("/api/assignments/series", json=body, headers=alice)
    assert response.status_code == 422
    assert "repeat days" in response.json()["detail"]


def test_series_in_someone_elses_course_is_404(client, alice, bob, make_course):
    body = series_body(make_course(bob)["id"])
    assert client.post("/api/assignments/series", json=body, headers=alice).status_code == 404


def test_editing_one_deadline_leaves_the_rest_alone(client, alice, labs):
    response = client.patch(
        f"/api/assignments/{labs[1]['id']}", json={"title": "Lab 2 (moved)"}, headers=alice
    )
    assert response.status_code == 200
    titles = [a["title"] for a in listed(client, alice)]
    assert titles == ["Lab 1", "Lab 2 (moved)", "Lab 3", "Lab 4"]


def following(lab: dict) -> str:
    return f"/api/assignments/{lab['id']}/following"


TZ = {"tz": "America/Toronto"}


def test_editing_this_and_following(client, alice, labs):
    changes = {"title": "Lab {n}: report", "priority": "high"}
    response = client.patch(following(labs[1]), json=changes, params=TZ, headers=alice)

    assert response.status_code == 200
    assert [a["id"] for a in response.json()] == [a["id"] for a in labs[1:]]
    now = listed(client, alice)
    assert [a["title"] for a in now] == ["Lab 1", "Lab 2: report", "Lab 3: report", "Lab 4: report"]
    assert [a["priority"] for a in now] == ["medium", "high", "high", "high"]


def test_moving_this_and_following_keeps_their_spacing_on_the_wall_clock(client, alice, labs):
    # Lab 2: Fri 30 Oct 23:59 -> Mon 2 Nov 09:00 (the clocks change in between).
    new_due = "2026-11-02T09:00:00-05:00"
    client.patch(following(labs[1]), json={"due_at": new_due}, params=TZ, headers=alice)

    local = [
        datetime.fromisoformat(a["due_at"]).astimezone(TORONTO).strftime("%a %d %b %H:%M")
        for a in listed(client, alice)
    ]
    assert local == ["Fri 23 Oct 23:59", "Mon 02 Nov 09:00", "Mon 09 Nov 09:00", "Mon 16 Nov 09:00"]


def test_status_cant_be_set_for_following(client, alice, labs):
    response = client.patch(following(labs[0]), json={"status": "done"}, params=TZ, headers=alice)
    assert response.status_code == 422


def test_following_needs_a_known_time_zone(client, alice, labs):
    for params in [{}, {"tz": "Nowhere/Special"}]:
        response = client.patch(following(labs[0]), json={}, params=params, headers=alice)
        assert response.status_code == 422


def test_moving_following_to_someone_elses_course_is_404(client, alice, bob, labs, make_course):
    body = {"course_id": make_course(bob)["id"]}
    response = client.patch(following(labs[0]), json=body, params=TZ, headers=alice)
    assert response.status_code == 404


def test_moving_following_to_another_of_your_courses(client, alice, labs, make_course):
    other = make_course(alice, code="EECS 2030")
    client.patch(following(labs[2]), json={"course_id": other["id"]}, params=TZ, headers=alice)
    assert [a["course_id"] == other["id"] for a in listed(client, alice)] == [
        False,
        False,
        True,
        True,
    ]


def test_deleting_this_and_following(client, alice, labs):
    assert client.delete(following(labs[2]), headers=alice).status_code == 204
    assert [a["title"] for a in listed(client, alice)] == ["Lab 1", "Lab 2"]


def test_deleting_one_deadline_keeps_the_series(client, alice, labs):
    client.delete(f"/api/assignments/{labs[1]['id']}", headers=alice)
    client.delete(following(labs[2]), headers=alice)
    assert [a["title"] for a in listed(client, alice)] == ["Lab 1"]


def test_following_on_a_one_off_deadline_means_just_that_one(
    client, alice, make_course, make_assignment
):
    course = make_course(alice)
    first = make_assignment(alice, course["id"], title="Essay")
    make_assignment(alice, course["id"], title="Other", due_at="2026-12-01T12:00:00Z")

    response = client.patch(following(first), json={"title": "Essay v2"}, params=TZ, headers=alice)

    assert [a["title"] for a in response.json()] == ["Essay v2"]
    assert client.delete(following(first), headers=alice).status_code == 204
    assert [a["title"] for a in listed(client, alice)] == ["Other"]


def test_other_users_cant_touch_a_series(client, bob, labs):
    assert client.patch(following(labs[0]), json={}, params=TZ, headers=bob).status_code == 404
    assert client.delete(following(labs[0]), headers=bob).status_code == 404
