"""The grade tracker: exact decimal maths, cautious rounding, the API, and the database checks."""

from decimal import Decimal

import pytest
from sqlalchemy.exc import IntegrityError

from app.grades import GradedItem, TargetStatus, letter_for, summarize
from app.models import Assignment

D = Decimal


def item(weight, score=None, out_of=None) -> GradedItem:
    return GradedItem(
        D(weight), None if score is None else D(score), None if out_of is None else D(out_of)
    )


def by_letter(summary):
    return {t.letter: t for t in summary.targets}


# --- the maths --------------------------------------------------------------------------------


def test_a_worked_example():
    # Labs 20%: 18/20. Midterm 30%: 60/80. Final 50%: not written yet.
    summary = summarize([item(20, 18, 20), item(30, 60, 80), item(50)])

    assert summary.total_weight == 100 and summary.graded_weight == 50
    assert summary.current == D("81.00") and summary.current_letter == "A"  # 40.5 of 50 points
    assert summary.lowest == D("40.50")  # zero on the final
    assert summary.highest == D("90.50")  # full marks on the final
    targets = by_letter(summary)
    assert targets["A+"].needed == D("99.00") and targets["A+"].status == TargetStatus.POSSIBLE
    assert targets["A"].needed == D("79.00")
    assert targets["E"].status == TargetStatus.SECURED and targets["E"].needed == 0
    assert [t.letter for t in summary.targets] == ["A+", "A", "B+", "B", "C+", "C", "D+", "D", "E"]


def test_needed_rounds_up_so_it_is_always_enough():
    # 50 of 70 points so far, 30 left. A B (70) needs 20/30 = 66.666…% on the rest.
    targets = by_letter(summarize([item(70, 5, 7), item(30)]))
    assert targets["B"].needed == D("66.67")  # not 66.66, which would fall just short
    assert targets["A"].needed == D("100.00") and targets["A"].status == TargetStatus.POSSIBLE
    assert targets["A+"].status == TargetStatus.OUT_OF_REACH


def test_grades_round_down_and_the_letter_agrees():
    summary = summarize([item(100, "8999.6", 10000)])  # 89.996%
    assert summary.current == D("89.99")  # not "90.00" next to an A
    assert summary.current_letter == "A"


def test_decimal_maths_is_exact():
    # In floats 0.1 + 0.2 is 0.30000000000000004; in Decimal it is exactly 0.3.
    summary = summarize([item("0.1", 1, 1), item("0.2", 1, 1), item("99.7")])
    assert summary.graded_weight == D("0.3")
    assert summary.current == D("100.00")


def test_nothing_graded_yet():
    summary = summarize([item(40), item(60)])
    assert summary.current is None and summary.current_letter is None
    assert (summary.lowest, summary.highest) == (D("0.00"), D("100.00"))
    assert by_letter(summary)["B"].needed == D("70.00")


def test_everything_graded():
    summary = summarize([item(50, 40, 50), item(50, 35, 50)])  # 75%
    targets = by_letter(summary)
    assert summary.current == summary.lowest == summary.highest == D("75.00")
    assert targets["B+"].status == TargetStatus.SECURED and targets["B+"].needed is None
    assert targets["A"].status == TargetStatus.OUT_OF_REACH and targets["A"].needed is None


def test_no_weights_at_all():
    summary = summarize([])
    assert summary.total_weight == 0
    assert summary.current is summary.lowest is summary.highest is None
    assert summary.targets == []


def test_weights_that_dont_add_up_to_100_are_scaled():
    # Only 60% entered so far: 30 of 40 points graded, 20 to go.
    summary = summarize([item(40, 30, 40), item(20)])
    assert summary.total_weight == 60
    assert summary.lowest == D("50.00")  # 30 / 60
    assert summary.highest == D("83.33")  # 50 / 60, rounded down


def test_bonus_marks_can_go_over_100():
    assert summarize([item(10, 11, 10)]).current == D("110.00")


@pytest.mark.parametrize(
    ("percent", "letter"),
    [
        ("100", "A+"),
        ("90", "A+"),
        ("89.99", "A"),
        ("75", "B+"),
        ("40", "E"),
        ("39.99", "F"),
        ("0", "F"),
    ],
)
def test_york_letters(percent, letter):
    assert letter_for(D(percent)) == letter


# --- the API ----------------------------------------------------------------------------------


@pytest.fixture
def course(alice, make_course):
    return make_course(alice)


def test_weights_and_marks_are_numbers_in_json(alice, course, make_assignment):
    lab = make_assignment(alice, course["id"], weight="7.5", score="18.5", out_of="20")
    assert (lab["weight"], lab["score"], lab["out_of"]) == (7.5, 18.5, 20.0)


def test_without_a_weight_everything_is_null(alice, course, make_assignment):
    lab = make_assignment(alice, course["id"])
    assert (lab["weight"], lab["score"], lab["out_of"]) == (None, None, None)


@pytest.mark.parametrize(
    "fields",
    [
        {"weight": 0},
        {"weight": "100.01"},
        {"weight": "7.555"},
        {"score": 18},
        {"out_of": 20},
        {"score": -1, "out_of": 20},
        {"score": 1, "out_of": 0},
    ],
    ids=[
        "zero-weight",
        "over-100",
        "too-precise",
        "score-alone",
        "out-of-alone",
        "negative",
        "out-of-zero",
    ],
)
def test_grade_validation(client, alice, course, fields):
    body = {"course_id": course["id"], "title": "Lab", "due_at": "2026-11-02T23:59:00Z", **fields}
    assert client.post("/api/assignments", json=body, headers=alice).status_code == 422


def test_entering_a_mark_later(client, alice, course, make_assignment):
    lab = make_assignment(alice, course["id"], weight="10")
    url = f"/api/assignments/{lab['id']}"

    assert client.patch(url, json={"score": 18}, headers=alice).status_code == 422  # out of what?
    response = client.patch(url, json={"score": 18, "out_of": 20}, headers=alice)
    assert (response.json()["score"], response.json()["out_of"]) == (18.0, 20.0)

    # A corrected score alone is fine now: out_of is already stored.
    assert client.patch(url, json={"score": "19.5"}, headers=alice).json()["score"] == 19.5
    # Clearing one half isn't; clearing both is.
    assert client.patch(url, json={"out_of": None}, headers=alice).status_code == 422
    cleared = client.patch(url, json={"score": None, "out_of": None}, headers=alice).json()
    assert (cleared["score"], cleared["out_of"], cleared["weight"]) == (None, None, 10.0)


def test_a_rejected_change_leaves_the_assignment_as_it_was(client, alice, course, make_assignment):
    lab = make_assignment(alice, course["id"], weight="10")
    url = f"/api/assignments/{lab['id']}"
    client.patch(url, json={"title": "Renamed", "score": 18}, headers=alice)
    assert client.get(url, headers=alice).json()["title"] == lab["title"]


def test_the_database_refuses_bad_grades_too(db, alice, course):
    db.add(Assignment(course_id=course["id"], title="x", due_at="2026-11-02T00:00Z", weight=150))
    with pytest.raises(IntegrityError, match="weight_is_a_percentage"):
        db.commit()


def series(course_id, **fields):
    return {
        "course_id": course_id,
        "title": "Lab {n}",
        "due_at": "2026-10-23T23:59:00-04:00",
        "repeat": {"weekdays": [4], "count": 3, "time_zone": "America/Toronto"},
        **fields,
    }


def test_a_series_can_share_a_weight_but_not_a_mark(client, alice, course):
    labs = client.post(
        "/api/assignments/series", json=series(course["id"], weight=2), headers=alice
    )
    assert [lab["weight"] for lab in labs.json()] == [2.0, 2.0, 2.0]

    marked = series(course["id"], weight=2, score=9, out_of=10)
    assert client.post("/api/assignments/series", json=marked, headers=alice).status_code == 422


def test_weight_for_following_but_marks_one_at_a_time(client, alice, course):
    labs = client.post("/api/assignments/series", json=series(course["id"]), headers=alice).json()
    url = f"/api/assignments/{labs[1]['id']}/following"
    params = {"tz": "America/Toronto"}

    changed = client.patch(url, json={"weight": 5}, params=params, headers=alice).json()
    assert [lab["weight"] for lab in changed] == [5.0, 5.0]
    mark = {"score": 9, "out_of": 10}
    assert client.patch(url, json=mark, params=params, headers=alice).status_code == 422


def grades(client, headers) -> list[dict]:
    response = client.get("/api/grades", headers=headers)
    assert response.status_code == 200
    return response.json()


def test_course_grades(client, alice, course, make_course, make_assignment):
    make_assignment(alice, course["id"], title="Labs", weight=20, score=18, out_of=20)
    make_assignment(alice, course["id"], title="Midterm", weight=30, score=60, out_of=80)
    make_assignment(alice, course["id"], title="Final", weight=50)
    make_assignment(alice, course["id"], title="Practice quiz")  # no weight: doesn't count
    empty = make_course(alice, code="MATH 1090")

    by_course = {g["course_id"]: g for g in grades(client, alice)}

    eecs = by_course[course["id"]]
    assert eecs["total_weight"] == 100 and eecs["graded_weight"] == 50
    assert (eecs["current"], eecs["current_letter"]) == (81.0, "A")
    assert (eecs["lowest"], eecs["highest"]) == (40.5, 90.5)
    assert eecs["targets"][0] == {
        "letter": "A+",
        "minimum": 90.0,
        "status": "possible",
        "needed": 99.0,
    }

    assert by_course[empty["id"]] == {
        "course_id": empty["id"],
        "total_weight": 0.0,
        "graded_weight": 0.0,
        "current": None,
        "current_letter": None,
        "lowest": None,
        "highest": None,
        "targets": [],
    }


def test_grades_are_per_user(client, alice, bob, course, make_course, make_assignment):
    make_assignment(alice, course["id"], weight=50, score=1, out_of=2)
    bobs = make_course(bob, code="PHYS 1800")

    assert [g["course_id"] for g in grades(client, bob)] == [bobs["id"]]
    assert grades(client, bob)[0]["total_weight"] == 0


def test_grades_need_a_login(client):
    assert client.get("/api/grades").status_code == 401
